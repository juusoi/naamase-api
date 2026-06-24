import { describe, it, expect } from "vitest";
import { PlaybookOutputSchema } from "../playbook-schema";

// A minimal but valid playbook payload; each test clones and mutates it to
// exercise one invariant. Mirrors the guarantees the former
// validate_faceit_data.py enforced.
function validPlaybook() {
  return {
    team: "Team",
    team_id: "tid",
    generated_at: "2026-06-24",
    source: "faceit-data-api-v4",
    format: "regular" as const,
    notes: ["a note"],
    seasons: ["S1"],
    filter: { competition_match: "", date_from: null, date_to: null },
    overall: { matches: 2, wins: 1, losses: 1, win_rate: 0.5 },
    maps: [
      {
        map: "de_mirage",
        display_name: "Mirage",
        matches: 2,
        wins: 1,
        losses: 1,
        win_rate: 0.5,
        rounds: { won: 20, lost: 18 },
        side_win_rate: null,
        veto: {
          picked_by_us: 1,
          picked_by_opp: 0,
          banned_by_us: 0,
          banned_by_opp: 0,
          decider: 0,
        },
        recent: [
          {
            date: "2026-06-20",
            opponent: "Bravo",
            result: "W" as const,
            score: "16-10",
            stage: "regular" as const,
            match_url: "https://example.test/room/1",
          },
        ],
      },
    ],
  };
}

describe("playbook-schema", () => {
  it("accepts a valid playbook", () => {
    expect(PlaybookOutputSchema.safeParse(validPlaybook()).success).toBe(true);
  });

  it("rejects overall wins+losses != matches", () => {
    const p = validPlaybook();
    p.overall.matches = 3; // 1 + 1 != 3
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects overall win_rate outside tolerance", () => {
    const p = validPlaybook();
    p.overall.win_rate = 0.9; // wins/matches = 0.5
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects a map whose wins+losses != matches", () => {
    const p = validPlaybook();
    p.maps[0]!.wins = 2; // 2 + 1 != 2
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects a win_rate outside 0..1", () => {
    const p = validPlaybook();
    p.maps[0]!.win_rate = 1.5;
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects a non-ISO generated_at", () => {
    const p = validPlaybook();
    p.generated_at = "2026-6-1";
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects an unknown format", () => {
    const p = validPlaybook();
    (p as any).format = "scrim";
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects duplicate map ids", () => {
    const p = validPlaybook();
    p.maps.push({ ...p.maps[0]! });
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects more than 10 recent entries", () => {
    const p = validPlaybook();
    const r = p.maps[0]!.recent[0]!;
    p.maps[0]!.recent = Array.from({ length: 11 }, () => ({ ...r }));
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });

  it("rejects a recent result other than W/L", () => {
    const p = validPlaybook();
    (p.maps[0]!.recent[0]! as any).result = "D";
    expect(PlaybookOutputSchema.safeParse(p).success).toBe(false);
  });
});
