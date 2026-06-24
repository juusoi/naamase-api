import { describe, it, expect } from "vitest";
import { isFinished, splitTeamMatches, myTeamResult } from "../team-utils";

// teams in object form, as FACEIT returns them; Object.values order is
// faction1 then faction2.
const teams = (a: string, b: string) => ({
  faction1: { team_id: a, name: `name-${a}` },
  faction2: { team_id: b, name: `name-${b}` },
});

describe("isFinished", () => {
  it("is true when finished_at is set", () => {
    expect(isFinished({ finished_at: 123 })).toBe(true);
  });
  it("is true for finished/closed status", () => {
    expect(isFinished({ status: "finished" })).toBe(true);
    expect(isFinished({ status: "closed" })).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isFinished({ status: "ongoing" })).toBe(false);
    expect(isFinished({})).toBe(false);
  });
});

describe("myTeamResult", () => {
  it("uses a direct team-id winner", () => {
    const m = { teams: teams("A", "B"), results: { winner: "A" } };
    expect(myTeamResult(m, "A")).toBe("win");
    expect(myTeamResult(m, "B")).toBe("loss");
  });

  it("maps a faction1/faction2 winner to the team id", () => {
    const m1 = { teams: teams("A", "B"), results: { winner: "faction1" } };
    expect(myTeamResult(m1, "A")).toBe("win");
    expect(myTeamResult(m1, "B")).toBe("loss");

    const m2 = { teams: teams("A", "B"), results: { winner: "faction2" } };
    expect(myTeamResult(m2, "B")).toBe("win");
    expect(myTeamResult(m2, "A")).toBe("loss");
  });

  it("falls back to score when winner is absent", () => {
    const m = { teams: teams("A", "B"), results: { score: { A: 16, B: 10 } } };
    expect(myTeamResult(m, "A")).toBe("win");
    expect(myTeamResult(m, "B")).toBe("loss");
  });

  it("returns draw on equal scores", () => {
    const m = { teams: teams("A", "B"), results: { score: { A: 15, B: 15 } } };
    expect(myTeamResult(m, "A")).toBe("draw");
  });

  it("returns unknown without winner or score", () => {
    const m = { teams: teams("A", "B"), results: {} };
    expect(myTeamResult(m, "A")).toBe("unknown");
  });
});

describe("splitTeamMatches", () => {
  it("filters to my matches and splits finished vs upcoming", () => {
    const finishedByDate = { teams: teams("A", "B"), finished_at: 100 };
    const finishedByStatus = { teams: teams("A", "C"), status: "finished" };
    const upcoming = { teams: teams("A", "D") };
    const notMine = { teams: teams("X", "Y") };

    const { upcoming: up, finished: fin } = splitTeamMatches(
      [finishedByDate, finishedByStatus, upcoming, notMine],
      "A",
    );
    expect(fin).toEqual([finishedByDate, finishedByStatus]);
    expect(up).toEqual([upcoming]);
  });
});
