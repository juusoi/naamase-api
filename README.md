# naamase-api

[![CI](https://github.com/juusoi/naamase-api/actions/workflows/ci.yml/badge.svg)](https://github.com/juusoi/naamase-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Code Style: Prettier](https://img.shields.io/badge/code%20style-prettier-ff69b4.svg)](https://prettier.io/)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)
![Node](https://img.shields.io/badge/node-LTS%20%28%E2%89%A524%29-brightgreen)
![pnpm](https://img.shields.io/badge/package%20manager-pnpm-F69220)
[![Issues](https://img.shields.io/github/issues/juusoi/naamase-api.svg)](https://github.com/juusoi/naamase-api/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/juusoi/naamase-api.svg)](https://github.com/juusoi/naamase-api/pulls)

Export FACEIT organizer/championship/leaderboard data to CSVs, and build a per-team JSON "playbook", via small CLIs.

## Setup

- Install prerequisites
  - Node.js 24 (matches .nvmrc and CI)
    - macOS (nvm): `nvm install --lts && nvm use --lts`
    - macOS (Homebrew): `brew install node && brew link --force node`
    - Linux (NodeSource): `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs`
    - Windows (winget): `winget install OpenJS.NodeJS.LTS` or download MSI from https://nodejs.org/
  - pnpm 11.x (Corepack ships with Node)
    - Any platform (Corepack): `corepack enable && corepack prepare pnpm@latest --activate`
    - macOS/Linux: `curl -fsSL https://get.pnpm.io/install.sh | sh -`
    - Windows (winget): `winget install pnpm.pnpm`

- Install deps: `pnpm install`
- Create `.env` with your API key (secret):

  ```bash
  FACEIT_API_KEY=your_api_key_here
  ```

- (Optional) Create a non‑secret config file by copying `faceit.config.example.json` to `faceit.config.json` and editing values. The real `faceit.config.json` is git‑ignored.

## Run

Using a config file:

```bash
pnpm exec tsx src/export-faceit.ts --config faceit.config.json
# or
pnpm run start:cfg
```

Preview the CSVs in a simple web UI:

```bash
pnpm run preview
# Open http://localhost:5174
```

Diagnose leaderboard standings endpoints (collect responses/headers):

```bash
pnpm run diag:standings
# or with a custom config path:
pnpm exec tsx src/diagnose-standings.ts --config path/to/config.json
```

Passing flags directly (CLI > config file > env):

```bash
pnpm start \
  --org-name "Pappaliiga" \
  --champ-name "24 Divisioona S11" \
  --lb-name "Div 24" \
  --game-id cs2 \
  --out-dir out
```

Outputs CSVs under the chosen out dir (default `out/`):

- `standings.csv`
- `teams.csv`
- `players.csv`
- `matches.csv`
- `match_players.csv`
- `team_players_agg.csv` (aggregate; per-team per-player across all matches)
- `my_team_players.csv` (when `my-team-id` provided)
- `my_team_upcoming.csv` (when `my-team-id` provided)
- `my_team_results.csv` (when `my-team-id` provided)
- `my_team_match_players.csv` (when `my-team-id` provided)
- `my_team_map_stats.csv` (when `my-team-id` provided; per map aggregated kills/deaths/assists/KD/KR/MVPs)
- `my_team_veto.csv` (when `my-team-id` provided; map picks/bans, best effort from match voting)
  - Columns: team1_bans, team2_bans, team1_pick, team2_pick, leftover_map, picks, bans
  - Assumes seasonal veto order: A ban, B ban, A ban, B ban, A pick, B pick; leftover derived from map pool
  - Override map pool via config key `map-pool` (comma-separated)
- `my_team_stats_overall.csv` (when `my-team-id` provided; single-row totals/averages across all maps and matches)
- `my_team_players_agg.csv` (when `my-team-id` provided; per-player aggregates for your team)
- `my_team_vs_opponents.csv` (when `my-team-id` provided; per-opponent W/L/D breakdown)

## Playbook (per-team JSON)

`pnpm playbook` builds a per-team "playbook": it crawls a team's full FACEIT match history, keeps only matches under one organizer, and aggregates per-map win/loss, rounds, and veto stats into a single JSON file.

It is configured entirely by environment variables (no CLI flags):

- `FACEIT_MY_TEAM_ID` (required) — the team to profile
- `FACEIT_ORGANIZER_ID` (required) — only matches under this organizer are counted
- `FACEIT_COMPETITION_FILTER` (optional) — label recorded in the output
- `FACEIT_PLAYBOOK_OUT` (optional) — output path (default `team_faceit.json`)

```bash
pnpm playbook
```

Raw API responses are cached under `raw/` so reruns are cheap; the output (`*_faceit.json`) and the cache are git-ignored. The output shape and its invariants are defined and validated by [`src/playbook-schema.ts`](src/playbook-schema.ts) — see [docs/playbook-contract.md](docs/playbook-contract.md).

## Flags and env

These apply to the CSV exporter (`pnpm start`):

- `--config` (file): JSON config file path (default tries `faceit.config.json`)
- `--org-id` | `FACEIT_ORGANIZER_ID`
- `--org-name` | `FACEIT_ORG_NAME`
- `--champ-id` | `FACEIT_CHAMPIONSHIP_ID`
- `--champ-name` | `FACEIT_CHAMP_NAME`
- `--lb-name` | `FACEIT_LB_NAME` (exact/partial)
- `--lb-id` | `FACEIT_LB_ID` (direct leaderboard id; preferred when known)
- `--lb-pattern` | `FACEIT_LB_PATTERN` (regex, case‑insensitive)
- `--game-id` | `FACEIT_GAME_ID` (default: `cs2`)
- `--out-dir` | `FACEIT_OUT_DIR` (default: `out`)
- `--my-team-id` | `FACEIT_MY_TEAM_ID` (optional; writes my-team CSVs)
- `--lb-group` | `FACEIT_LB_GROUP` (optional; force numeric leaderboard group)
- `--debug` | `FACEIT_DEBUG` (optional; log available leaderboards)
- `--clean-out` | `FACEIT_CLEAN_OUT` (optional; delete output dir before writing)

Notes:

- Provide either organizer id or name, and either championship id or name.
- If `lb-name` is not provided, the app uses `lb-pattern`. If neither is set and exactly one leaderboard exists, it selects that one; otherwise it errors with guidance.

## Config

Example `faceit.config.json` (non-secret):

```json
{
  "org-id": "1bfc69fa-5a21-4ed9-9ef3-37edbd7210d8",
  "org-name": "Pappaliiga",
  "champ-name": "24 Divisioona S11",
  "lb-id": "688f88d5b48fdb73713e39f8",
  "lb-pattern": "div\\s*24",
  "game-id": "cs2",
  "out-dir": "out",
  "my-team-id": "00000000-0000-0000-0000-000000000000",
  "map-pool": "anubis,ancient,mirage,inferno,nuke,dust2,vertigo",
  "clean-out": false
}
```

Notes:

- Do not store `FACEIT_API_KEY` in this file; use `.env`.
- If standings endpoints are not available for your key/competition, the exporter logs and continues; team lists will be inferred from matches.

Config keys (what they do)

- `org-id` | `org-name`: Organizer identifier. Prefer `org-id`; fallback resolves `org-name` to id.
- `champ-id` | `champ-name`: Championship identifier. Prefer `champ-id`; else resolve by name + `org-id` + `game-id`.
- `lb-id` | `lb-name` | `lb-group` | `lb-pattern`: Leaderboard selection. Prefer `lb-id`; else match by exact/partial name, numeric group, or regex pattern.
- `game-id`: FACEIT game key (`cs2` default) used when resolving championship by name.
- `out-dir`: Output directory for CSVs.
- `my-team-id`: When provided, writes my-team CSVs (roster, upcoming, results, per-player, per-map, aggregates, veto).
- `map-pool`: Comma‑separated list for veto leftover detection.
- `skip-standings`: Skips standings calls; infers team ids from matches.
- `debug`: Prints available leaderboards (id/group) to aid selection.
- `clean-out`: Deletes `out-dir` before writing to avoid stale files.

## Scripts

- `pnpm run typecheck` — TypeScript check
- `pnpm run lint` — ESLint
- `pnpm run test` — Vitest
- `pnpm start` — Run the exporter
- `pnpm run start:cfg` — Run with `faceit.config.json`
- `pnpm run preview` — Serve CSV viewer (http://localhost:5174)
- `pnpm run init` — Resolve and populate ids in `faceit.config.json`
- `pnpm run diag:standings` — Probe standings endpoints

## Internals

- CLI: `src/export-faceit.ts`
- Helper lookups: `src/faceit-helpers.ts`
- Parsers: `src/parsers.ts`
- Team utils: `src/team-utils.ts`
- Simple static viewer: `public/viewer.html` (served by `src/preview.ts`)
- Standings diagnosis tool: `src/diagnose-standings.ts`

## License

MIT — see [LICENSE](LICENSE).
