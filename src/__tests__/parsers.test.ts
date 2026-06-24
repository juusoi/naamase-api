import { describe, it, expect } from "vitest";
import {
  extractTeamEntries,
  extractTeamIds,
  extractTeamsBasic,
} from "../parsers";

describe("extractTeamEntries", () => {
  it("returns arrays as-is", () => {
    const arr = [{ team_id: "A" }];
    expect(extractTeamEntries(arr)).toBe(arr);
  });
  it("returns object values", () => {
    expect(
      extractTeamEntries({
        faction1: { team_id: "A" },
        faction2: { team_id: "B" },
      }),
    ).toEqual([{ team_id: "A" }, { team_id: "B" }]);
  });
  it("returns [] for null/undefined", () => {
    expect(extractTeamEntries(null)).toEqual([]);
    expect(extractTeamEntries(undefined)).toEqual([]);
  });
});

describe("extractTeamIds", () => {
  it("reads team_id, faction_id, and nested team.team_id, dropping falsy", () => {
    const teams = [
      { team_id: "A" },
      { faction_id: "B" },
      { team: { team_id: "C" } },
      { name: "no id" },
    ];
    expect(extractTeamIds(teams)).toEqual(["A", "B", "C"]);
  });
});

describe("extractTeamsBasic", () => {
  it("maps id and name with fallbacks", () => {
    const teams = {
      faction1: { team_id: "A", name: "Alpha" },
      faction2: { team: { team_id: "B", name: "Bravo" } },
    };
    expect(extractTeamsBasic(teams)).toEqual([
      { team_id: "A", name: "Alpha" },
      { team_id: "B", name: "Bravo" },
    ]);
  });
});
