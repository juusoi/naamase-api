# Repository Guidelines

## Project Structure & Module Organization

- `src/export-faceit.ts` — main CLI exporter (reads config/env, writes CSVs).
- `src/faceit-helpers.ts` — HTTP + FACEIT Data API helpers (retry/backoff, resolvers).
- `src/parsers.ts` — safe helpers for teams/players extraction from payloads.
- `src/team-utils.ts` — team utilities (split matches, compute results/aggregates).
- `src/preview.ts` — small Node HTTP server to browse CSVs.
- `src/diagnose-standings.ts` — diagnostics for leaderboard/standings endpoints.
- `public/viewer.html` — static CSV viewer UI.
- `src/__tests__/` — unit tests (Vitest). `out/` — generated CSVs.
- `faceit.config.example.json` — non‑secret config template.

## Build, Test, and Development Commands

- `pnpm start` — run exporter with env/config/flags.
- `pnpm run start:cfg` — run with `faceit.config.json`.
- `pnpm run preview` — serve `out/` via `src/preview.ts` (http://localhost:5174).
- `pnpm run diag:standings` — probe standings endpoints and print results.
- `pnpm run typecheck` | `pnpm run lint` | `pnpm run test` — TS, ESLint, Vitest.
- `pnpm run format` — Prettier write.

## Coding Style & Naming Conventions

- TypeScript (ESNext), 2‑space indent, kebab‑case filenames (e.g., `team-utils.ts`).
- Tests end with `.test.ts` under `src/__tests__/`.
- Lint: ESLint flat config (`eslint.config.js`) with `@typescript-eslint`.
- Format: Prettier. Keep PRs free of lint errors.

## Testing Guidelines

- Framework: Vitest. Prefer testing pure helpers (parsers, team-utils). Mock `fetch` for API calls.
- Commands: `pnpm run test` (CI), `pnpm run test:watch` (local), `pnpm run coverage`.

## Commit & Pull Request Guidelines

- Keep commits small and focused; present‑tense messages. Example: `feat(export): add my-team aggregates`.
- PRs: describe scope/rationale and user‑visible changes (flags/outputs). Update README when behavior changes.
- Link issues; add screenshots/logs for diagnostics when relevant. Never commit secrets.

## Security & Configuration Tips

- Secrets only in `.env` (e.g., `FACEIT_API_KEY`). Never commit `.env`.
- Non‑secrets in `faceit.config.json` (ignored by Git). Use `--clean-out` to refresh `out/` before runs.
