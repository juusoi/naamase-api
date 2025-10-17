import "dotenv/config";

const BASE = "https://open.faceit.com/data/v4";
const H = {
  Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
  Accept: "application/json",
};

async function j(u: string) {
  let attempt = 0;
  while (true) {
    const r = await fetch(u, { headers: H });
    if (r.ok) return r.json();
    // Backoff on rate limiting
    if (r.status === 429 && attempt < 5) {
      const ra = r.headers.get("retry-after");
      const reset = r.headers.get("ratelimit-reset");
      const waitMs = ra
        ? Number(ra) * 1000
        : reset
          ? Number(reset) * 1000
          : 500 * (attempt + 1);
      await new Promise((res) => setTimeout(res, waitMs));
      attempt++;
      continue;
    }
    // Surface error body if available
    let body = "";
    try {
      body = await r.text();
    } catch (e) {
      // ignore
    }
    throw new Error(`${r.status} ${u}${body ? `\n${body}` : ""}`);
  }
}

// Organizer by name → organizer_id
export async function getOrganizerIdByName(name: string): Promise<string> {
  const paramKeys = ["name", "search", "query"];
  for (const key of paramKeys) {
    const u = new URL(`${BASE}/organizers`);
    u.searchParams.set(key, name);
    u.searchParams.set("limit", "100");
    u.searchParams.set("offset", "0");
    try {
      const data = (await j(u.toString())) as {
        items?: { organizer_id: string; name?: string }[];
      };
      const items = data.items ?? [];
      const exact = items.find(
        (o) => (o.name ?? "").toLowerCase() === name.toLowerCase(),
      );
      if (exact?.organizer_id) return exact.organizer_id;
      const partial = items.find((o) =>
        (o.name ?? "").toLowerCase().includes(name.toLowerCase()),
      );
      if (partial?.organizer_id) return partial.organizer_id;
    } catch {
      // Try next param key on error (some keys may 400)
      continue;
    }
  }
  throw new Error(`Organizer not found by name: ${name}`);
}

// Organizer → championship by name → championship_id
export async function getChampionshipIdByName(
  organizerId: string,
  champName: string,
  gameId = "cs2",
): Promise<string> {
  let off = 0;
  // page through championships
  for (;;) {
    const u = new URL(`${BASE}/organizers/${organizerId}/championships`);
    u.searchParams.set("limit", "100");
    u.searchParams.set("offset", String(off));
    const page = (await j(u.toString())) as { items?: any[] };
    const items = page.items ?? [];
    const exact = items.find(
      (c) => (c.name || "").trim() === champName && c.game_id === gameId,
    );
    if (exact?.championship_id) return exact.championship_id as string;
    const partial = items.find(
      (c) => (c.name || "").includes(champName) && c.game_id === gameId,
    );
    if (partial?.championship_id) return partial.championship_id as string;
    off += items.length;
    if (items.length === 0) break;
  }
  throw new Error(
    `Championship not found by name: ${champName} under organizer ${organizerId}`,
  );
}

// Championship → leaderboard by name → group index
export async function getLeaderboardGroupByName(
  champId: string,
  lbName: string,
): Promise<number> {
  let off = 0;
  for (;;) {
    const u = new URL(`${BASE}/leaderboards/championships/${champId}`);
    u.searchParams.set("limit", "200");
    u.searchParams.set("offset", String(off));
    const page = (await j(u.toString())) as { items?: any[] };
    const items = page.items ?? [];
    const nameOf = (x: any) => (x?.name ?? x?.title ?? "") as string;
    const exact = items.find((lb) => nameOf(lb).trim() === lbName);
    if (exact?.group !== undefined) return exact.group as number;
    const partial = items.find((lb) => nameOf(lb).includes(lbName));
    if (partial?.group !== undefined) return partial.group as number;
    off += items.length;
    if (items.length === 0) break;
  }
  throw new Error(`Leaderboard not found by name: ${lbName} under ${champId}`);
}

// Player by nickname → player_id (wraps /players search)
export async function getPlayerIdByNickname(nickname: string): Promise<string> {
  const u = new URL(`${BASE}/players`);
  u.searchParams.set("nickname", nickname);
  const data = (await j(u.toString())) as { player_id?: string };
  if (!data.player_id)
    throw new Error(`Player not found by nickname: ${nickname}`);
  return data.player_id;
}
