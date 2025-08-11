# Claude IssueOps: 使い方

- 使い方: テンプレから Issue 作成 → ラベル `claude-code` 付与（テンプレは自動で付与） → Actions 実行 → PR 作成 → 成果物確認
- 成果物の保存先: `artifacts/issue-<番号>/output.md`

## Secrets 設定

- GitHub リポジトリ設定 → Settings → Secrets and variables → Actions
  - `ANTHROPIC_API_KEY`: Anthropic の API キー（必須）
  - `ANTHROPIC_MODEL`: 任意（未設定時は `claude-3-5-sonnet-20240620`）

## 再実行方法

- Issue を編集して保存、またはラベルを付け直すと再実行されます。

## 監査の見方

- Actions の各ジョブログを確認
- 作成された PR の差分・履歴を確認

## ローカル実行（デバッグ向け）

> 通常は GitHub Actions 上で実行されます。ローカルで実行する場合は `ANTHROPIC_API_KEY` が必要です。

```
nvm use
npm ci
ANTHROPIC_API_KEY=... node scripts/run_claude.mjs
```

