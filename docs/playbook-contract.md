# Playbook JSON contract

`src/playbook.ts` emits a per-team "playbook" JSON file (default `team_faceit.json`)
aggregating a team's FACEIT match history per map.

The contract is defined **as code** in [`src/playbook-schema.ts`](../src/playbook-schema.ts)
using [zod](https://zod.dev). That schema is the single source of truth:

- the TypeScript type `PlaybookOutput` is derived from it (`z.infer`), so the
  producer in `playbook.ts` is checked at compile time;
- the same schema validates the output at runtime — `playbook.ts` runs
  `PlaybookOutputSchema.safeParse(...)` before writing and refuses to emit invalid data.

This replaces the former standalone `validate_faceit_data.py`: the shape is now
documented, type-checked, and validated from one place that cannot drift.

## Shape

```jsonc
{
  "team": "string",
  "team_id": "string",
  "generated_at": "YYYY-MM-DD",
  "source": "faceit-data-api-v4",
  "format": "regular" | "playoff" | "mixed",
  "notes": ["string", ...],          // API limitations / attribution caveats
  "seasons": ["string", ...],
  "filter": {
    "competition_match": "string",   // label only; filtering is by organizer_id
    "date_from": "string | null",
    "date_to": "string | null"
  },
  "overall": {
    "matches": 0, "wins": 0, "losses": 0,
    "win_rate": 0.0                  // 0..1
  },
  "maps": [
    {
      "map": "de_mirage",            // non-empty, unique across the array
      "display_name": "Mirage",
      "matches": 0, "wins": 0, "losses": 0,
      "win_rate": 0.0,               // 0..1
      "rounds": { "won": 0, "lost": 0 },
      "side_win_rate": null | { "ct": 0.0 | null, "t": 0.0 | null },
      "veto": null | {
        "picked_by_us": 0, "picked_by_opp": 0,
        "banned_by_us": 0, "banned_by_opp": 0,
        "decider": 0
      },
      "recent": [                    // most-recent first, max 10
        {
          "date": "YYYY-MM-DD",
          "opponent": "string",
          "result": "W" | "L",
          "score": "string",
          "stage": "regular" | "playoff",
          "match_url": "string"
        }
      ]
    }
  ]
}
```

## Invariants (enforced by the schema)

- All counts are non-negative integers; all rates are numbers in `0..1`.
- `generated_at` and `recent[].date` are ISO `YYYY-MM-DD` dates.
- For both `overall` and each `maps[]` entry: `wins + losses == matches`, and
  `win_rate == wins / matches` within a tolerance of `0.01` (skipped when
  `matches == 0`).
- `map` ids are unique across `maps`.
- `recent` holds at most 10 entries.

## Known limitations

These are recorded in the output's `notes` because the FACEIT Data API v4 cannot
provide them:

- `side_win_rate` is `null` — starting side is not exposed; it would require demo
  parsing.
- `veto.banned_by_*` are `0` — `voting.map` exposes only picked maps, not the ban
  sequence, so per-faction ban attribution is unavailable.
- Veto pick attribution assumes `faction1` acts first (FACEIT convention); in a
  best-of-3 the third picked map is treated as the decider.
