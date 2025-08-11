import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';
import fetch from 'node-fetch';
import { Octokit } from '@octokit/rest';

const execFile = promisify(_execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(path.join(__dirname, '..'));

function log(msg) {
  process.stdout.write(`[runner] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function backoffFetch(url, options, retries = 2) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      const bodyText = await res.text().catch(() => '');
      lastErr = new Error(`HTTP ${res.status}: ${bodyText}`);
      log(`API error: ${lastErr.message}. Retry in ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
      await sleep(delay);
      attempt++;
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  throw lastErr || new Error('Unknown error contacting provider');
}

function getEnv(name, required = false) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v;
}

async function getEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p) return null;
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    log(`Failed to parse GITHUB_EVENT_PATH: ${e.message}`);
    return null;
  }
}

async function ensureGitIdentity() {
  try {
    await execFile('git', ['config', '--get', 'user.email'], { cwd: repoRoot });
  } catch {
    await execFile('git', ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], { cwd: repoRoot });
  }
  try {
    await execFile('git', ['config', '--get', 'user.name'], { cwd: repoRoot });
  } catch {
    await execFile('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: repoRoot });
  }
}

async function currentBranch() {
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function checkoutBranch(name) {
  // Create or reset branch to current HEAD
  await execFile('git', ['checkout', '-B', name], { cwd: repoRoot });
}

async function pushBranch(name) {
  await execFile('git', ['push', '-u', 'origin', name], { cwd: repoRoot });
}

async function run() {
  const event = await getEvent();
  const repoFull = getEnv('GITHUB_REPOSITORY') || (event && event.repository && event.repository.full_name) || '';
  const [owner, repo] = repoFull.split('/');
  const issue = event && event.issue ? event.issue : null;
  const isIssuesEvent = (process.env.GITHUB_EVENT_NAME || '').startsWith('issues');

  if (!issue || !isIssuesEvent) {
    log('No issues event detected. This script is intended to run in GitHub Actions for issues events.');
  }

  const hasLabel = Array.isArray(issue?.labels) && issue.labels.some(l => (l.name || l) === 'claude-code');
  if (isIssuesEvent && !hasLabel) {
    log('Issue does not have claude-code label. Exiting.');
    return;
  }

  const issueNumber = issue?.number;
  const issueTitle = issue?.title || '';
  const issueBody = issue?.body || '';

  const provider = (getEnv('PROVIDER') || 'stub').toLowerCase();
  const anthropicKey = getEnv('ANTHROPIC_API_KEY');
  const anthropicModel = getEnv('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-20240620';
  const openaiKey = getEnv('OPENAI_API_KEY');
  const openaiModel = getEnv('OPENAI_MODEL') || 'gpt-4o-mini';

  const octokitToken = getEnv('GITHUB_TOKEN');
  const octokit = octokitToken ? new Octokit({ auth: octokitToken }) : new Octokit();

  const systemPrompt = `You are a meticulous software engineer.
Given a GitHub Issue body, produce the requested artifacts in a concise, actionable markdown deliverable.
- Focus on the requested code or docs only.
- Include short context when needed.
- Avoid external links unless necessary.
`;

  let contentMd = '';
  let artifactDir = path.join(repoRoot, 'artifacts');
  if (issueNumber) artifactDir = path.join(artifactDir, `issue-${issueNumber}`);
  const artifactPath = path.join(artifactDir, 'output.md');

  let prUrl = '';
  let prNumber = null;
  const branchName = issueNumber ? `issue-${issueNumber}-claude` : `issue-unknown-claude-${Date.now()}`;
  let baseBranch = 'main';

  try {
    if (!issueBody) throw new Error('Issue body is empty');

    if (provider === 'anthropic') {
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
      // Call Anthropic Messages API with retry
      const reqBody = {
        model: anthropicModel,
        max_tokens: 4096,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          { role: 'user', content: issueBody }
        ]
      };
      const res = await backoffFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(reqBody)
      });
      const data = await res.json();
      const parts = Array.isArray(data.content) ? data.content : [];
      contentMd = parts.map(p => (p.type === 'text' ? p.text : '')).join('\n\n');
      if (!contentMd?.trim()) throw new Error('Anthropic returned empty content');
    } else if (provider === 'openai') {
      if (!openaiKey) throw new Error('OPENAI_API_KEY not set');
      const sys = 'あなたは熟練のソフトウェアエンジニアです。出力は日本語で、必要なコードは完全なファイル内容を Markdown とコードブロックで示してください。冗長さを避け、実行/適用可能な形でまとめてください。';
      const reqBody = {
        model: openaiModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: issueBody }
        ]
      };
      const res = await backoffFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify(reqBody)
      });
      const data = await res.json();
      const choice = data?.choices?.[0]?.message?.content;
      contentMd = (choice || '').toString();
      if (!contentMd?.trim()) throw new Error('OpenAI returned empty content');
    } else {
      // stub mode: produce a deterministic markdown without external calls
      const excerpt = issueBody.replace(/\r/g, '').slice(0, 400);
      const bullets = excerpt.split(/\n+/).slice(0, 8).map(l => `- ${l.trim().slice(0, 140)}`).join('\n');
      contentMd = `[STUB OUTPUT]\n\n## 自動実行の検証用ダミー出力\n\n### 概要\n- これは配管検証用のダミー出力です\n- PROVIDER=stub で生成されています\n\n### 入力サマリ\n${bullets || '- (入力なし)'}\n\n### 次の手順\n- この PR をレビューして配管を確認する\n- PROVIDER=anthropic or openai に切替えて本番検証\n\n✅ Pipeline OK（stub）`;
    }

    // Write artifact
    await fs.mkdir(artifactDir, { recursive: true });
    const header = `# Output for issue #${issueNumber}: ${issueTitle}\n\n`;
    await fs.writeFile(artifactPath, header + contentMd, 'utf8');
    log(`Saved artifact at ${path.relative(repoRoot, artifactPath)}`);

    // Prepare git commit on a new branch
    await ensureGitIdentity();
    await checkoutBranch(branchName);
    // Force-add artifact even if artifacts/ is in .gitignore
    await execFile('git', ['add', '-f', path.relative(repoRoot, artifactPath)], { cwd: repoRoot });
    await execFile('git', ['commit', '-m', `chore(claude): artifacts for issue #${issueNumber}`], { cwd: repoRoot });

    // Determine default branch for PR base
    try {
      if (owner && repo) {
        const repoInfo = await octokit.repos.get({ owner, repo });
        if (repoInfo?.data?.default_branch) baseBranch = repoInfo.data.default_branch;
      }
    } catch (e) {
      log(`Failed to fetch default branch, using '${baseBranch}': ${e.message}`);
    }

    // Push branch
    await pushBranch(branchName);

    // Create PR
    if (owner && repo) {
      const prTitle = `chore(claude): add artifacts for issue #${issueNumber}`;
      const prBody = `This PR adds generated artifacts for issue #${issueNumber}.\n\n- Artifact: \`${path.posix.join('artifacts', `issue-${issueNumber}`, 'output.md')}\`\n- Provider: \`${provider}\`\n- Model: \`${provider === 'anthropic' ? anthropicModel : provider === 'openai' ? openaiModel : 'stub'}\``;
      try {
        const pr = await octokit.pulls.create({ owner, repo, title: prTitle, head: branchName, base: baseBranch, body: prBody });
        prUrl = pr.data.html_url;
        prNumber = pr.data.number;
        log(`Created PR: ${prUrl}`);
      } catch (e) {
        const msg = e?.message || String(e);
        log(`PR creation skipped: ${msg}`);
        // Continue without failing; include manual PR link in the issue comment below
      }
    }

    // Comment on issue
    if (owner && repo && issueNumber) {
      const manualPrUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(branchName)}?expand=1`;
      const body = `Completed. Generated artifacts saved to \`${path.posix.join('artifacts', `issue-${issueNumber}`, 'output.md')}\`.\nProvider=\`${provider}\`${prUrl ? `\nOpened PR: ${prUrl}` : `\nPR creation skipped. Open manually: ${manualPrUrl}`}`;
      await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    log(`Error: ${msg}`);
    if (owner && repo && issueNumber) {
      const body = `Failed to complete Claude run. Error: \`${msg}\``;
      try {
        await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
      } catch (e2) {
        log(`Failed to post failure comment: ${e2.message}`);
      }
    }
    process.exitCode = 1;
  }
}

run();
