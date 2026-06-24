import { z } from "zod";

// Contract for the playbook JSON emitted by src/playbook.ts.
// This is the single source of truth: the static type (PlaybookOutput) and the
// runtime validation both derive from it. Replaces the former
// validate_faceit_data.py — the schema documents the shape, the refinements
// enforce the arithmetic invariants that a type alone cannot.

const RATE_TOL = 0.01; // tolerance for win_rate vs wins/matches

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date YYYY-MM-DD");
const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1);

const consistentRecord = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .refine(
      (o: any) => o.wins + o.losses === o.matches,
      "wins + losses must equal matches",
    )
    .refine(
      (o: any) =>
        o.matches === 0 ||
        Math.abs(o.win_rate - o.wins / o.matches) <= RATE_TOL,
      "win_rate must match wins / matches",
    );

const Recent = z.object({
  date: isoDate,
  opponent: z.string(),
  result: z.enum(["W", "L"]),
  score: z.string(),
  stage: z.enum(["regular", "playoff"]),
  match_url: z.string(),
});

const MapStats = consistentRecord({
  map: z.string().min(1),
  display_name: z.string(),
  matches: count,
  wins: count,
  losses: count,
  win_rate: rate,
  rounds: z.object({ won: count, lost: count }),
  side_win_rate: z
    .object({ ct: rate.nullable(), t: rate.nullable() })
    .nullable(),
  veto: z
    .object({
      picked_by_us: count,
      picked_by_opp: count,
      banned_by_us: count,
      banned_by_opp: count,
      decider: count,
    })
    .nullable(),
  recent: z.array(Recent).max(10),
});

const Overall = consistentRecord({
  matches: count,
  wins: count,
  losses: count,
  win_rate: rate,
});

export const PlaybookOutputSchema = z
  .object({
    team: z.string(),
    team_id: z.string(),
    generated_at: isoDate,
    source: z.string(),
    format: z.enum(["regular", "playoff", "mixed"]),
    notes: z.array(z.string()),
    seasons: z.array(z.string()),
    filter: z.object({
      competition_match: z.string(),
      date_from: z.string().nullable(),
      date_to: z.string().nullable(),
    }),
    overall: Overall,
    maps: z.array(MapStats),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.maps.forEach((m, i) => {
      if (seen.has(m.map))
        ctx.addIssue({
          code: "custom",
          message: `duplicate map id ${m.map}`,
          path: ["maps", i, "map"],
        });
      seen.add(m.map);
    });
  });

export type PlaybookOutput = z.infer<typeof PlaybookOutputSchema>;
