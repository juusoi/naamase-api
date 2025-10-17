import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getOrganizerIdByName,
  getChampionshipIdByName,
  getLeaderboardGroupByName,
  getPlayerIdByNickname,
} from "../faceit-helpers";

const g = globalThis as any;

function okJson(data: any) {
  return { ok: true, json: async () => data } as any;
}

describe("faceit-helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves organizer id by exact name", async () => {
    g.fetch = vi.fn(async (u: string) => {
      const url = new URL(u);
      if (url.pathname.endsWith("/organizers")) {
        return okJson({
          items: [{ organizer_id: "ORG1", name: "Pappaliiga" }],
        });
      }
      throw new Error("unexpected fetch: " + u);
    });
    await expect(getOrganizerIdByName("Pappaliiga")).resolves.toBe("ORG1");
    expect(g.fetch).toHaveBeenCalledTimes(1);
  });

  it("resolves organizer id by partial name when exact missing", async () => {
    g.fetch = vi.fn(async (u: string) => {
      const url = new URL(u);
      if (url.pathname.endsWith("/organizers")) {
        return okJson({
          items: [{ organizer_id: "ORG2", name: "Pappaliiga CS2" }],
        });
      }
      throw new Error("unexpected fetch: " + u);
    });
    await expect(getOrganizerIdByName("Pappaliiga")).resolves.toBe("ORG2");
  });

  it("resolves championship id by name across pages", async () => {
    g.fetch = vi.fn(async (u: string) => {
      const url = new URL(u);
      if (url.pathname.includes("/organizers/ORG1/championships")) {
        const offset = url.searchParams.get("offset");
        if (offset === "0") {
          return okJson({
            items: [{ name: "Other", game_id: "cs2", championship_id: "CHX" }],
          });
        }
        return okJson({
          items: [
            {
              name: "24 Divisioona S11",
              game_id: "cs2",
              championship_id: "CH1",
            },
          ],
        });
      }
      throw new Error("unexpected fetch: " + u);
    });
    await expect(
      getChampionshipIdByName("ORG1", "24 Divisioona S11", "cs2"),
    ).resolves.toBe("CH1");
  });

  it("resolves leaderboard group by name across pages", async () => {
    g.fetch = vi.fn(async (u: string) => {
      const url = new URL(u);
      if (url.pathname.includes("/leaderboards/championships/CH1")) {
        const offset = url.searchParams.get("offset");
        if (offset === "0") {
          return okJson({ items: [{ name: "Wrong LB", group: 1 }] });
        }
        return okJson({ items: [{ name: "24 Divisioona", group: 5 }] });
      }
      throw new Error("unexpected fetch: " + u);
    });
    await expect(
      getLeaderboardGroupByName("CH1", "24 Divisioona"),
    ).resolves.toBe(5);
  });

  it("resolves player id by nickname", async () => {
    g.fetch = vi.fn(async (u: string) => {
      const url = new URL(u);
      if (
        url.pathname.endsWith("/players") &&
        url.searchParams.get("nickname") === "nick"
      ) {
        return okJson({ player_id: "P1" });
      }
      throw new Error("unexpected fetch: " + u);
    });
    await expect(getPlayerIdByNickname("nick")).resolves.toBe("P1");
  });

  it("throws when player not found", async () => {
    g.fetch = vi.fn(async (u: string) => okJson({}));
    await expect(getPlayerIdByNickname("missing")).rejects.toThrow();
  });
});
