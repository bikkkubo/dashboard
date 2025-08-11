---
name: "Claude Task"
about: "Ask Claude to generate code/docs and open a PR"
title: ""
labels: ["claude-code"]
assignees: []
---

## 目的

この Issue は Claude に小さなタスクを依頼し、成果物（コード/ドキュメント）を PR として提案させるためのものです。

## 入力

例）ディレクトリ構成、インターフェース、要件、制約、想定ケースなどを明確に記載してください。

## 期待出力

例）生成ファイル一覧、実装の概要、テスト方法など。

## テスト

ローカル/CI での確認手順があれば記載。

## 完了条件

- 成果物が `artifacts/issue-<no>/output.md` に保存される
- 自動で PR が作成され、Issue にコメントが付きます

