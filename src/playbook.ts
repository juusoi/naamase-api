import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { BASE, faceitFetchCached as fetchCached } from "./faceit-client";
import { myTeamResult } from "./team-utils";
import { PlaybookOutputSchema, type PlaybookOutput } from "./playbook-schema";

const TEAM_ID = process.env.FACEIT_MY_TEAM_ID ?? "";
const ORG_ID = process.env.FACEIT_ORGANIZER_ID ?? "";
// Matches are filtered by ORG_ID. competition_name may not contain the
// organizer's public name, so COMPETITION_FILTER is only a label recorded in
// the output (set FACEIT_COMPETITION_FILTER to document which league this is).
const COMPETITION_FILTER = process.env.FACEIT_COMPETITION_FILTER ?? "";
const OUT = process.env.FACEIT_PLAYBOOK_OUT ?? "team_faceit.json";
const GENERATED_AT = new Date().toISOString().slice(0, 10);

if (!TEAM_ID) throw new Error("FACEIT_MY_TEAM_ID not set");
if (!ORG_ID) throw new Error("FACEIT_ORGANIZER_ID not set");

const MAP_DISPLAY: Record<string, string> = {
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  de_cache: "Cache",
  de_cobblestone: "Cobblestone",
  de_dust2: "Dust2",
  de_inferno: "Inferno",
  de_mirage: "Mirage",
  de_nuke: "Nuke",
  de_overpass: "Overpass",
  de_train: "Train",
  de_vertigo: "Vertigo",
};

const NOTES = [
  "side_win_rate is null: FACEIT API v4 does not expose starting side; computing it would require demo parsing.",
  "banned_by_us and banned_by_opp are 0: voting.map exposes only the picked maps, not the ban sequence, so per-faction ban attribution is unavailable from this API.",
  "Veto pick attribution assumes faction1 acts first (FACEIT convention); in a best-of-3 the third picked map is treated as the decider.",
];

if (!(process.env.FACEIT_API_KEY ?? "").trim())
  throw new Error("FACEIT_API_KEY not set");

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function epochToDate(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

function matchStage(match: any): "regular" | "playoff" {
  const comp = ((match.competition_name ?? "") as string).toLowerCase();
  const bo = (match.best_of as number) ?? 2;
  return comp.includes("playoff") || bo >= 3 ? "playoff" : "regular";
}

type RecentEntry = {
  date: string;
  opponent: string;
  result: "W" | "L";
  score: string;
  stage: "regular" | "playoff";
  match_url: string;
  _ts: number;
};

type MapAgg = {
  matches: number;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsLost: number;
  pickedByUs: number;
  pickedByOpp: number;
  bannedByUs: number;
  bannedByOpp: number;
  decider: number;
  recent: RecentEntry[];
};

type MatchData = {
  match: any;
  stats: any | null;
  ourFactionKey: string;
  oppName: string;
};

(async () => {
  // 1. Team roster
  console.log("Fetching team roster...");
  const team = (await fetchCached(`${BASE}/teams/${TEAM_ID}`)) as any;
  const teamName = team.name as string;
  // /teams/{id} members use user_id; /players/{id}/history accepts the same UUID
  const members = (team.members ?? []) as {
    user_id?: string;
    player_id?: string;
    nickname: string;
  }[];
  console.log(`  ${teamName}: ${members.length} members`);

  // 2. Collect match IDs from all roster players' histories (unbounded — all seasons)
  console.log("Collecting match history...");
  const matchIds = new Set<string>();
  for (const member of members) {
    const playerId = member.user_id ?? member.player_id;
    if (!playerId) {
      console.warn(`  No player ID for ${member.nickname}, skipping`);
      continue;
    }
    let offset = 0;
    for (;;) {
      const u = new URL(`${BASE}/players/${playerId}/history`);
      u.searchParams.set("game", "cs2");
      u.searchParams.set("offset", String(offset));
      u.searchParams.set("limit", "100");
      const page = (await fetchCached(u.toString())) as { items?: any[] };
      const items = page.items ?? [];
      for (const item of items) {
        if (item.match_id) matchIds.add(item.match_id as string);
      }
      if (items.length < 100) break;
      offset += 100;
    }
    console.log(`  ${member.nickname}: ${matchIds.size} match IDs so far`);
  }
  console.log(`  Total unique: ${matchIds.size}`);

  // 3. Fetch match details + stats; filter to this organizer
  console.log("Fetching match details + stats...");
  const orgMatches: MatchData[] = [];
  let n = 0;
  for (const matchId of matchIds) {
    n++;
    if (n % 10 === 0) process.stdout.write(`  ${n}/${matchIds.size}\r`);

    const match = (await fetchCached(`${BASE}/matches/${matchId}`)) as any;
    if (match.organizer_id !== ORG_ID) continue;

    const teams = (match.teams as Record<string, any>) ?? {};
    const factionKeys = Object.keys(teams);
    // Championship matches: team_id is null, faction_id equals the premade team_id
    const ourKey = factionKeys.find(
      (k) => teams[k]?.team_id === TEAM_ID || teams[k]?.faction_id === TEAM_ID,
    );
    if (!ourKey) continue;

    const oppKey = factionKeys.find((k) => k !== ourKey)!;
    const oppName = (teams[oppKey]?.name ?? "Unknown") as string;

    const stats = await fetchCached(`${BASE}/matches/${matchId}/stats`).catch(
      () => null,
    );
    orgMatches.push({ match, stats, ourFactionKey: ourKey, oppName });
  }
  process.stdout.write("\n");
  console.log(`  Matches for this organizer: ${orgMatches.length}`);

  // 4. Aggregate
  const mapAgg = new Map<string, MapAgg>();
  const seasons = new Set<string>();
  const stagesSeen = new Set<"regular" | "playoff">();
  let overallWins = 0;
  let overallLosses = 0;

  // Pass A: map stats from round data
  for (const { match, stats, ourFactionKey, oppName } of orgMatches) {
    const compName = (match.competition_name ??
      match.league_name ??
      "") as string;
    if (compName) seasons.add(compName);

    const stage = matchStage(match);
    stagesSeen.add(stage);

    const result = myTeamResult(match, TEAM_ID);
    if (result === "win") overallWins++;
    else if (result === "loss") overallLosses++;

    const teams = (match.teams as Record<string, any>) ?? {};
    const ourTeamName = (
      (teams[ourFactionKey]?.name ?? "") as string
    ).toLowerCase();
    const rounds = Array.isArray(stats?.rounds) ? (stats.rounds as any[]) : [];

    for (const round of rounds) {
      const mapId = (round.round_stats?.Map ?? "") as string;
      if (!mapId) continue;

      const roundTeams = (round.teams ?? []) as any[];
      // Match our team: by team_id first (= faction_id in championship context),
      // then by name in team_stats.Team, then by faction position as fallback.
      const ourTeam =
        roundTeams.find((t: any) => t.team_id === TEAM_ID) ??
        roundTeams.find(
          (t: any) =>
            (
              (t.team_stats?.Team ?? t.team ?? t.name ?? "") as string
            ).toLowerCase() === ourTeamName,
        ) ??
        (ourFactionKey === "faction1" ? roundTeams[0] : roundTeams[1]);
      const oppTeam = roundTeams.find((t: any) => t !== ourTeam);

      // Stats API uses "Final Score"; "Team Score" is the older field name.
      const score = (t: any) =>
        parseInt(
          (t?.team_stats?.["Final Score"] ??
            t?.team_stats?.["Team Score"] ??
            "0") as string,
          10,
        ) || 0;
      const ourScore = score(ourTeam);
      const oppScore = score(oppTeam);

      if (!mapAgg.has(mapId)) {
        mapAgg.set(mapId, {
          matches: 0,
          wins: 0,
          losses: 0,
          roundsWon: 0,
          roundsLost: 0,
          pickedByUs: 0,
          pickedByOpp: 0,
          bannedByUs: 0,
          bannedByOpp: 0,
          decider: 0,
          recent: [],
        });
      }

      const agg = mapAgg.get(mapId)!;
      agg.matches++;
      if (ourScore > oppScore) agg.wins++;
      else agg.losses++;
      agg.roundsWon += ourScore;
      agg.roundsLost += oppScore;

      const finishedAt = (match.finished_at ?? 0) as number;
      agg.recent.push({
        date: finishedAt ? epochToDate(finishedAt) : "1970-01-01",
        opponent: oppName,
        result: ourScore > oppScore ? "W" : "L",
        score: `${ourScore}-${oppScore}`,
        stage,
        match_url: `https://www.faceit.com/en/cs2/room/${match.match_id}`,
        _ts: finishedAt,
      });
    }
  }

  // Pass B: veto attribution
  // voting.map has: entities (pool) and pick (played maps, in veto order).
  // No ban sequence is exposed by the API — banned_by_* remain 0.
  //
  // Pick attribution by faction position (faction1 acts first by FACEIT convention):
  //   BO2: picks[0] = faction1 pick, picks[1] = faction2 pick
  //   BO3: picks[0] = faction1 pick, picks[1] = faction2 pick, picks[2] = decider (leftover)
  for (const { match, ourFactionKey } of orgMatches) {
    const voting = match.voting?.map ?? {};
    const picks = Array.isArray(voting.pick) ? (voting.pick as string[]) : [];
    const bestOf = (match.best_of as number) ?? 2;
    const weAreFaction1 = ourFactionKey === "faction1";

    for (let i = 0; i < picks.length; i++) {
      const mapId = picks[i];
      if (!mapId || !mapAgg.has(mapId)) continue;
      const agg = mapAgg.get(mapId)!;

      // In BO3 the third entry in picks is the decider (leftover after 4 bans + 2 picks)
      if (bestOf >= 3 && i === 2) {
        agg.decider++;
      } else {
        const ours = weAreFaction1 ? i === 0 : i === 1;
        if (ours) agg.pickedByUs++;
        else agg.pickedByOpp++;
      }
    }
  }

  // 5. Build output
  const totalMatches = orgMatches.length;
  const format: "regular" | "playoff" | "mixed" =
    stagesSeen.size === 2
      ? "mixed"
      : stagesSeen.has("playoff")
        ? "playoff"
        : "regular";

  const maps = [...mapAgg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mapId, s]) => ({
      map: mapId,
      display_name: MAP_DISPLAY[mapId] ?? mapId,
      matches: s.matches,
      wins: s.wins,
      losses: s.losses,
      win_rate: s.matches > 0 ? round3(s.wins / s.matches) : 0,
      rounds: { won: s.roundsWon, lost: s.roundsLost },
      side_win_rate: null,
      veto: {
        picked_by_us: s.pickedByUs,
        picked_by_opp: s.pickedByOpp,
        banned_by_us: s.bannedByUs,
        banned_by_opp: s.bannedByOpp,
        decider: s.decider,
      },
      recent: s.recent
        .sort((a, b) => b._ts - a._ts)
        .slice(0, 10)
        .map(({ _ts, ...r }) => r),
    }));

  const output: PlaybookOutput = {
    team: teamName,
    team_id: TEAM_ID,
    generated_at: GENERATED_AT,
    source: "faceit-data-api-v4",
    format,
    notes: NOTES,
    seasons: [...seasons].sort(),
    filter: {
      competition_match: COMPETITION_FILTER,
      date_from: null,
      date_to: null,
    },
    overall: {
      matches: totalMatches,
      wins: overallWins,
      losses: overallLosses,
      win_rate: totalMatches > 0 ? round3(overallWins / totalMatches) : 0,
    },
    maps,
  };

  // Validate against the playbook contract before writing — never emit data
  // that downstream consumers can't trust.
  const validation = PlaybookOutputSchema.safeParse(output);
  if (!validation.success) {
    console.error("Playbook output failed contract validation:");
    for (const issue of validation.error.issues)
      console.error(`  [${issue.path.join(".")}] ${issue.message}`);
    process.exit(1);
  }

  await writeFile(OUT, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log(`  Format: ${format}`);
  console.log(`  Matches: ${totalMatches} (${overallWins}W ${overallLosses}L)`);
  console.log(`  Maps: ${maps.length}`);
  console.log(`  Seasons: ${[...seasons].sort().join(", ")}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
