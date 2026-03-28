<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# tinyfish-remora Agent Contract

## Project Identity

- Treat this repository as a standalone first-party product.
- Do not add origin-story, handoff, or historical-source language to committed files, user-facing copy, or generated documentation.
- The public project name is `tinyfish-remora`.

## Product Surface

- `tinyfish-remora` is an end-to-end trading demo for TinyFish-driven signal collection, autonomous strategy generation, venue connection management, and paper/live trading workflows.
- The core product vocabulary is:
  - recipes
  - strategies
  - runs
  - signals
  - decisions
  - receipts
  - positions
  - P&L

## Coding Rules

- Prefer minimal, composable changes that preserve the current App Router structure.
- Keep user-facing copy product-first and concrete.
- Do not add speculative architecture or placeholder historical notes.
- Preserve the current TypeScript, Tailwind, and App Router conventions already used in the repo.
- Validate meaningful changes with `npm run lint` and `npm run build` unless the task explicitly does not require it.

## Secrets and Local Private Inputs

- `.env.example` is committed and should contain variable names only.
- `.env.local` is the local secret-value file and must never be committed.
- `AGENT_PRIVATE.local.md` is the local operator-only instruction file and must never be committed.
- If `AGENT_PRIVATE.local.md` exists, agents should consult it for local runbooks, account mappings, demo notes, and other private instructions.
- Never print raw secrets into committed files, screenshots, logs, or user-facing output.
- When configuration is missing, name the missing environment variable or local file explicitly instead of inventing values.

## Private-File Boundaries

- `AGENTS.md` is the shared committed instruction file for all contributors and agents.
- `AGENT_PRIVATE.local.md` is for local-only guidance. Its contents must not be copied into committed files unless the content is intentionally public, non-sensitive, and product-facing.
- Do not create committed history, handoff, or source-tracking documents unless the user explicitly asks for a public design doc.
