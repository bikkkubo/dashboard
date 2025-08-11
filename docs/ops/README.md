# Claude IssueOps: 使い方

- 使い方: テンプレから Issue 作成 → ラベル `claude-code` 付与（テンプレは自動で付与） → Actions 実行 → PR 作成 → 成果物確認
- 成果物の保存先: `artifacts/issue-<番号>/output.md`

## プロバイダ切替（検証/本番）

- 既定: `PROVIDER=stub`（配管検証用のダミー出力）
- 本番: `PROVIDER=anthropic` または `PROVIDER=openai`

切替方法（いずれか）:
- 一時的にワークフロー実行時に `PROVIDER` を上書き
- `.github/workflows/claude_runner.yml` の `env:` を編集

利用モデル（既定値あり）:
- Anthropic: `ANTHROPIC_MODEL`（既定: `claude-3-5-sonnet-20240620`）
- OpenAI: `OPENAI_MODEL`（既定: `gpt-4o-mini`）

## Secrets 設定

- GitHub リポジトリ設定 → Settings → Secrets and variables → Actions
  - `ANTHROPIC_API_KEY`: Anthropic の API キー（Anthropic 利用時に必須）
  - `OPENAI_API_KEY`: OpenAI の API キー（OpenAI 利用時に必須）
  - 変数（任意）: `ANTHROPIC_MODEL` / `OPENAI_MODEL`

## 再実行方法

- Issue を編集して保存、またはラベルを付け直すと再実行されます。

## 監査の見方

- Actions の各ジョブログを確認
- 作成された PR の差分・履歴を確認

## ローカル実行（デバッグ向け）

> 通常は GitHub Actions 上で実行されます。

```
nvm use
npm ci
# 検証（スタブ）
PROVIDER=stub node scripts/run_claude.mjs

# Anthropic（Secrets が必要）
PROVIDER=anthropic ANTHROPIC_API_KEY=... node scripts/run_claude.mjs

# OpenAI（Secrets が必要）
PROVIDER=openai OPENAI_API_KEY=... node scripts/run_claude.mjs
```
