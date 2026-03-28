# Parallel Codex Worktree Guide

Use this guide to run multiple Codex tasks in parallel while keeping PRs focused and reviewable.

## 1) Sync `main`

```bash
git checkout main
git pull --ff-only
```

## 2) Create a scoped branch and worktree

Pick a branch name that maps directly to one issue or task.

```bash
git worktree add ../tinyfish-remora-<task-slug> -b codex/<task-slug> main
```

Example:

```bash
git worktree add ../tinyfish-remora-codex-ops -b codex/codex-ops-docs main
```

## 3) Work only inside approved write scope

Before editing, restate your write scope (for example: `README.md`, `.env.example`, `.github/**`, `docs/**`) and keep every change inside it.

## 4) Keep PRs operationally narrow

- One concern per PR.
- Keep docs/scaffolding changes separate from product behavior.
- Avoid drive-by refactors outside your assigned scope.

## 5) Validate in the worktree

```bash
source ~/.nvm/nvm.sh
npm ci
npm run lint
npm run build
```

Run Playwright only when the task explicitly requires it and tests are available:

```bash
npx playwright test
```

## 6) Commit discipline

- Use clear commit messages scoped to the task.
- Do not commit `.env.local` or local operator files.
- Confirm changed files are inside scope:

```bash
git status --short
```

## 7) PR discipline

Open a PR to `main` with:

- what changed
- exact files added/updated
- validation commands and results
- whether Playwright was run and why

Recommended title pattern for codex task branches:

```text
[codex/<task-slug>] <short summary>
```
