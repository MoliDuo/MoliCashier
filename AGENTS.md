# AGENTS.md

<!-- prettier-ignore-start -->
<!-- moli-rules:start -->
## Moli rules (copied verbatim from MoliSpec; do not edit)

These rules apply to every Moli repository. The full standards live in the private repo `MoliDuo/MoliSpec` (`standards/`).

**Naming**
- Product name `MoliFoo` (repo, package, file and identifier names, no spaces). User-facing name is `Moli Foo` (one space): window titles, app name, UI text, README title, Release titles.

**Deploy and CI**
- Deploy only after CI passes. Merging to `main` deploys to production (server apps), so run the check entry (`npm run check` or the stack's equivalent) locally before opening the PR, and watch CI and the deploy after it merges.
- Keep the CI names fixed: workflows `ci` / `deploy` / `release` / `codeql`; jobs `check`, `gitleaks`, `build`, `integration`, `ci-gate`.
- Never delete or skip tests, or loosen lint rules, to make a check pass.

**Git**
- Conventional Commits (`feat(scope): subject`).
- Never push to `main` directly. Every change, however small, goes on a new branch and is merged through a PR with auto-merge on. Before starting, update local `main` (`git switch main && git pull`) and branch from it; if a push is rejected or the branch is behind, pull the latest `main` and merge or rebase it in.
- Never force-push `main`. Roll back with `git revert`.

**Secrets and private information**
- Never commit secrets, `.env` files, keys, or internal information (server addresses, hostnames, Tailscale addresses, personal emails). Use obviously fake values in tests and examples (`test-token`, `example.com`, `192.0.2.1`).
- Never print secret values in logs, chat, or commits. Never store secrets in the OS keychain. Runtime secrets live in the server `.env` (mode 600); build and release secrets live in GitHub organization secrets.
- Do not copy a shared (organization-level) secret into repository-level secrets unless the administrator has said so.

**Login, data, config**
- Sign-in is Authelia only. Do not build your own accounts, passwords or registration pages.
- Database and settings schemas only add; never delete or rename an existing field in one step. Migrations must keep the previous app version working.
- Clients are offline-first and the server is authoritative. Settings are read in the order defined in the config standard; do not invent a second source.
- Server apps expose `GET /healthz` returning `{"ok": true, "version": "<commit sha>"}`, run as non-root, take config from environment variables, and publish no host ports.

**Working with the user**
- Do only what was asked. Do not publish, delete, or change shared settings (GitHub org, server, DNS) without being asked.
- Reply to the user in Chinese, briefly.
<!-- moli-rules:end -->
<!-- prettier-ignore-end -->

## About this project

Moli Cashier is built for the two people who use it. [README.md](./README.md) covers setup,
configuration, deployment, and the command list; the documents below are the authority for how the
code is organized and tested.

- [docs/architecture.md](./docs/architecture.md) — layering, dependency direction, data model,
  concurrency, background runtime, authentication, and frontend conventions.
- [docs/testing.md](./docs/testing.md) — test placement, isolation, and how each suite runs.
- [docs/api.md](./docs/api.md) — the public API v1 contract.

## Agent behavior

- Read `docs/architecture.md` before changing module boundaries, server actions, queries, the data
  model, or cross-module flows. Refactors move toward it; a change that departs from it updates that
  document first.
- Preserve inward dependency direction. Keep routes and API handlers in `src/app/`, feature logic
  in `src/modules/`, cross-module background flows in `src/server/`, shared infrastructure in
  `src/lib/`, and database definitions and migrations in `src/persistence/`.
- Prefer existing repository patterns over new abstractions. Keep changes scoped, avoid unrelated
  rewrites, and do not revert user changes in a dirty worktree.
- Add focused regression coverage for behavior changes, placed as `docs/testing.md` describes. Run
  the narrowest relevant checks while working and `npm run check` before declaring completion.
- Validate external input with Zod, require an authenticated session (or an API credential) for
  ledger data, and never log tokens, raw personal data, provider credentials, or image contents.
- Treat database, object-storage, generated-history, and backup cleanup as destructive. Review the
  target set before deleting it.
- Never commit `.env`, provider credentials, real receipts, API keys, or raw personal data.

## Repository gate

`npm run check` must pass before you push. It runs formatting (Prettier), the architecture
check (dependency-cruiser), dead-code detection (knip), ESLint with zero warnings, `tsc`, the full
test suite with the coverage thresholds in `vitest.config.mts`, and a production build against
isolated placeholders with the protected-route bundle budget. The static checks run side by side and
stop the gate on the first failure; the tests and the build then run side by side, and a summary
lists each step's time. Integration tests need a running Docker daemon. Run `npm run test:smoke` as
well when a change touches sign-in, routing, or the flows the smoke specs cover.

Deployment is automatic: a push to `main` runs the `ci` workflow, and when `ci-gate` passes the
`deploy` workflow builds `moli-cashier:<commit sha>` and ships it to the server (see
[docs/deploy.md](./docs/deploy.md)). So the local gate is not the only gate, but it must still pass
before you push, and you watch CI after.

## Migrations

- Generate with drizzle-kit, then keep the migration as hand-written SQL; keep only the latest
  snapshot and format the journal with Prettier.
- Migrations only add. The deploy keeps the previous release able to run against the new schema, so a
  column or table that the code stops using is dropped by a migration in the _next_ release, never in the
  same one, and nothing is renamed in one step. Names the model no longer mentions but the database
  still has go in `retiredNames` in the schema contract test.
- Every pending migration runs in one transaction under an advisory lock, so a failed migration leaves
  the database untouched. The deploy takes a `pg_dump` first (`deploy/pre-deploy.sh`).
- Name constraints and indexes `uq_<table>_…`, `idx_<table>_…`, `fk_<table>_<target>` and
  `ck_<table>_…`; primary keys stay `<table>_pkey`. The schema contract test enforces it.

## Commits

- Conventional Commit subjects: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`,
  `build:`; mark breaking changes with `!`.
- Subjects describe the behavior change in plain words. Keep code, comments, and commit messages in
  English; user-facing documentation is in Chinese.
- Do not commit generated files such as `repomix-output.xml`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
