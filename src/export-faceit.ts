import "dotenv/config";
import { stringify } from "csv-stringify/sync";
import {
  getOrganizerIdByName,
  getChampionshipIdByName,
  getLeaderboardGroupByName,
} from "./faceit-helpers";
import { extractTeamIds, extractTeamsBasic } from "./parsers";
import { splitTeamMatches, myTeamResult } from "./team-utils";

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
    let body = "";
    try {
      body = await r.text();
    } catch {
      body = ""; // noop: keep empty body if text read fails
    }
    throw new Error(`${r.status} ${u}${body ? `\n${body}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type CliArgs = {
  config?: string;
  "org-id"?: string;
  "org-name"?: string;
  "champ-id"?: string;
  "champ-name"?: string;
  "lb-id"?: string;
  "lb-name"?: string;
  "lb-group"?: string | number;
  "lb-pattern"?: string;
  "game-id"?: string;
  "out-dir"?: string;
  "skip-standings"?: boolean;
  "my-team-id"?: string;
  debug?: boolean;
  "clean-out"?: boolean;
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1] as string | undefined;
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out as CliArgs;
}

async function loadConfig(path?: string): Promise<Partial<CliArgs>> {
  const fs = await import("node:fs/promises");
  const candidate = path ?? "faceit.config.json";
  try {
    const raw = await fs.readFile(candidate, "utf8");
    const json = JSON.parse(raw) as Partial<CliArgs>;
    return json;
  } catch {
    return {};
  }
}

async function listChampLeaderboards(champId: string, limit = 100, offset = 0) {
  const u = new URL(`${BASE}/leaderboards/championships/${champId}`);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  return j(u.toString()) as Promise<{ items: any[] }>;
}

async function getDivisionStandings(
  champId: string,
  group: number,
  limit = 100,
  offset = 0,
) {
  const u = new URL(
    `${BASE}/leaderboards/championships/${champId}/groups/${group}`,
  );
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  return j(u.toString()) as Promise<{ items: any[] }>;
}

// Standings via leaderboard_id (documented path returns entries under `/leaderboards/{id}`)
async function getLeaderboardStandingsById(
  leaderboardId: string,
  limit = 20,
  offset = 0,
) {
  const u = new URL(`${BASE}/leaderboards/${leaderboardId}`);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  return (await j(u.toString())) as { items: any[] };
}

async function listChampMatches(champId: string, limit = 100, offset = 0) {
  const u = new URL(`${BASE}/championships/${champId}/matches`);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  return j(u.toString()) as Promise<{ items: any[] }>;
}

async function getMatchStats(id: string) {
  return j(`${BASE}/matches/${id}/stats`);
}

async function getTeam(teamId: string) {
  return j(`${BASE}/teams/${teamId}`);
}

// Team parsing helpers moved to src/parsers.ts

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const fileCfg = await loadConfig(args.config as string | undefined);

  // Basic secret validation
  const apiKey = (process.env.FACEIT_API_KEY || "").trim();
  if (!apiKey || apiKey.length < 10) {
    throw new Error(
      "FACEIT_API_KEY missing or invalid. Set it in .env (dotenv) or environment.",
    );
  }

  const OUT_DIR = (args["out-dir"] ||
    fileCfg["out-dir"] ||
    process.env.FACEIT_OUT_DIR ||
    "out") as string;
  const GAME_ID = (args["game-id"] ||
    fileCfg["game-id"] ||
    process.env.FACEIT_GAME_ID ||
    "cs2") as string;

  const ORG_ID = (args["org-id"] ||
    fileCfg["org-id"] ||
    process.env.FACEIT_ORGANIZER_ID) as string | undefined;
  const ORG_NAME = (args["org-name"] ||
    fileCfg["org-name"] ||
    process.env.FACEIT_ORG_NAME) as string | undefined;

  if (!ORG_ID && !ORG_NAME) {
    throw new Error(
      "Provide --org-id or --org-name (or FACEIT_ORGANIZER_ID / FACEIT_ORG_NAME)",
    );
  }

  const CHAMP_ID = (args["champ-id"] ||
    fileCfg["champ-id"] ||
    process.env.FACEIT_CHAMPIONSHIP_ID) as string | undefined;
  const CHAMP_NAME = (args["champ-name"] ||
    fileCfg["champ-name"] ||
    process.env.FACEIT_CHAMP_NAME) as string | undefined;
  if (!CHAMP_ID && !CHAMP_NAME) {
    throw new Error(
      "Provide --champ-id or --champ-name (or FACEIT_CHAMPIONSHIP_ID / FACEIT_CHAMP_NAME)",
    );
  }

  const LB_ID = (args["lb-id"] ||
    fileCfg["lb-id"] ||
    process.env.FACEIT_LB_ID) as string | undefined;
  const LB_NAME = (args["lb-name"] ||
    fileCfg["lb-name"] ||
    process.env.FACEIT_LB_NAME) as string | undefined;
  const LB_GROUP = (args["lb-group"] ||
    fileCfg["lb-group"] ||
    process.env.FACEIT_LB_GROUP) as string | number | undefined;
  const LB_PATTERN = (args["lb-pattern"] ||
    fileCfg["lb-pattern"] ||
    process.env.FACEIT_LB_PATTERN) as string | undefined;
  const SKIP_STANDINGS = Boolean(
    args["skip-standings"] ??
      fileCfg["skip-standings"] ??
      process.env.FACEIT_SKIP_STANDINGS,
  );
  const MY_TEAM_ID = (args["my-team-id"] ||
    fileCfg["my-team-id"] ||
    process.env.FACEIT_MY_TEAM_ID) as string | undefined;
  const DEBUG = Boolean(
    args["debug"] ?? fileCfg["debug"] ?? process.env.FACEIT_DEBUG,
  );
  const MAP_POOL = ((fileCfg as any)["map-pool"] ||
    process.env.FACEIT_MAP_POOL ||
    // Default CS2 Active Duty (override via config if needed)
    "anubis,ancient,mirage,inferno,nuke,dust2,vertigo") as string;
  const mapPoolList = String(MAP_POOL)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const CLEAN_OUT = Boolean(
    (args["clean-out"] as any) ??
      (fileCfg as any)["clean-out"] ??
      process.env.FACEIT_CLEAN_OUT,
  );

  // Prepare output directory (optional clean)
  const fs = await import("node:fs/promises");
  if (CLEAN_OUT) {
    await fs.rm(OUT_DIR, { recursive: true, force: true });
  }

  const organizerId = ORG_ID ?? (await getOrganizerIdByName(ORG_NAME!));
  const championshipId =
    CHAMP_ID ??
    (await getChampionshipIdByName(organizerId, CHAMP_NAME!, GAME_ID));
  const championship = (await j(
    `${BASE}/championships/${championshipId}`,
  )) as any;

  // Load leaderboards (one page is typically enough; some APIs 400 on offset>0)
  const lfirst = await listChampLeaderboards(championshipId, 200, 0);
  const lbs: any[] = lfirst.items ?? [];

  const nameStr = (x: any) => (x?.name ?? x?.title ?? "") as string;
  let groupIndex: number | undefined;
  let chosenLb: any | undefined;

  if (DEBUG) {
    const minimal = lbs.map((lb) => ({
      name: nameStr(lb),
      group: lb.group,
      id:
        (lb as any).id ??
        (lb as any).leaderboard_id ??
        (lb as any).group_id ??
        undefined,
      raw: lb,
    }));
    console.error("DEBUG leaderboards:", JSON.stringify(minimal, null, 2));
  }

  if (LB_ID) {
    chosenLb = lbs.find((lb) => (lb as any).leaderboard_id === LB_ID) ?? {
      leaderboard_id: LB_ID,
    };
    groupIndex = (chosenLb as any).group as number | undefined;
  } else if (LB_GROUP !== undefined && LB_GROUP !== null && LB_GROUP !== "") {
    const parsed =
      typeof LB_GROUP === "string" ? parseInt(LB_GROUP, 10) : LB_GROUP;
    if (!Number.isNaN(parsed as number)) {
      groupIndex = parsed as number;
      chosenLb = lbs.find((lb) => (lb.group as number) === groupIndex);
    }
  } else if (LB_NAME) {
    try {
      groupIndex = await getLeaderboardGroupByName(championshipId, LB_NAME);
      chosenLb = lbs.find((lb) => (lb.group as number) === groupIndex);
    } catch {
      chosenLb =
        lbs.find((lb) => nameStr(lb).trim() === LB_NAME) ||
        lbs.find((lb) => nameStr(lb).includes(LB_NAME));
      groupIndex = chosenLb?.group as number | undefined;
    }
  }
  if (!groupIndex) {
    if (LB_PATTERN) {
      const re = new RegExp(LB_PATTERN, "i");
      chosenLb = lbs.find((lb) => re.test(nameStr(lb)));
      groupIndex = chosenLb?.group as number | undefined;
    }
    if (!groupIndex && lbs.length === 1) {
      chosenLb = lbs[0];
      groupIndex = chosenLb.group as number;
    }
  }
  if (groupIndex === undefined && !LB_ID) {
    const available = lbs.map((lb) => ({ name: nameStr(lb), group: lb.group }));
    console.error("Available leaderboards:", available);
    throw new Error(
      "Leaderboard group not resolved. Provide --lb-name or --lb-pattern (or FACEIT_LB_NAME / FACEIT_LB_PATTERN).",
    );
  }

  // Standings (optional; resilient to API errors)
  let standings: any[] = [];
  let teamIds: string[] = [];
  if (!SKIP_STANDINGS) {
    try {
      const lbId =
        ((chosenLb as any)?.leaderboard_id as string | undefined) ?? LB_ID;
      if (lbId) {
        for (let soff = 0; ; soff += 20) {
          const spage = await getLeaderboardStandingsById(lbId, 20, soff);
          const items = spage.items ?? [];
          standings.push(...items);
          if (items.length < 20) break;
        }
      } else if (typeof groupIndex === "number") {
        for (let soff = 0; ; soff += 100) {
          const spage = await getDivisionStandings(
            championshipId,
            groupIndex,
            100,
            soff,
          );
          const items = spage.items ?? [];
          standings.push(...items);
          if (items.length < 100) break;
        }
      } else {
        throw new Error("No leaderboard group available for standings");
      }

      teamIds = [
        ...new Set(
          standings
            .map((row: any) => row.team?.team_id ?? row.entity_id)
            .filter(Boolean),
        ),
      ] as string[];
    } catch (e) {
      console.error(
        "Fetching standings failed; continuing without standings. Error:",
        e,
      );
    }
  }

  const teamsDetailed = [] as any[];
  for (const t of teamIds) {
    const td = await getTeam(t).catch(() => null);
    if (td) teamsDetailed.push(td);
    await sleep(150);
  }

  const players = teamsDetailed.flatMap((t: any) =>
    (t.members ?? []).map((m: any) => ({
      team_id: t.team_id,
      team_name: t.name,
      player_id: m.player_id,
      nickname: m.nickname,
      role: m.role,
    })),
  );

  // Matches limited to division teams
  let allMatches: any[] = [];
  for (let moff = 0; ; moff += 100) {
    const mpage = await listChampMatches(championshipId, 100, moff);
    const items = mpage.items ?? [];
    allMatches.push(...items);
    if (items.length < 100) break;
  }

  // If standings skipped or empty, infer team ids from matches
  if (teamIds.length === 0) {
    const inferred = new Set<string>();
    for (const m of allMatches) {
      for (const id of extractTeamIds(m.teams)) inferred.add(id);
    }
    teamIds = [...inferred];
  }
  const teamSet = new Set(teamIds);
  const divMatches = allMatches.filter((m: any) => {
    const idsInMatch = new Set(extractTeamIds(m.teams));
    return (
      [...idsInMatch].filter((id) => teamSet.has(id as string)).length >= 2
    );
  });

  const withStats: any[] = [];
  for (const m of divMatches) {
    const stats = await getMatchStats(m.match_id).catch(() => null);
    withStats.push({ ...m, stats });
    await sleep(200);
  }

  // Build helper map: team_id -> team_name from matches
  const teamNameById = new Map<string, string>();
  for (const m of withStats) {
    const ts = extractTeamsBasic(m.teams);
    for (const t of ts) {
      if (t.team_id && t.name) teamNameById.set(t.team_id, t.name);
    }
  }

  // Flatten player stats lines across all maps/rounds
  const lines: any[] = [];
  for (const m of withStats) {
    const rounds = Array.isArray(m.stats?.rounds)
      ? (m.stats.rounds as any[])
      : [];
    // Build mapping from team name → team_id when available in match payload
    const ts = extractTeamsBasic(m.teams);
    const nameToId = new Map<string, string>();
    for (const t of ts)
      if (t.team_id && t.name)
        nameToId.set(String(t.name).toLowerCase(), t.team_id);
    for (const r of rounds) {
      for (const t of r.teams ?? []) {
        const teamName = String((t.team ?? t.name ?? "") as string).trim();
        // Prefer explicit ids from stats team, else map via match teams name
        const statTeamId = (t as any)?.team_id ?? (t as any)?.faction_id ?? "";
        const mappedId = teamName
          ? nameToId.get(teamName.toLowerCase())
          : undefined;
        const teamId = (statTeamId || mappedId || "") as string;
        const finalTeamName =
          teamName || (teamId ? teamNameById.get(teamId) || "" : "");
        for (const p of t.players ?? []) {
          lines.push({
            match_id: m.match_id,
            map: r.round_stats?.Map ?? "",
            team_id: teamId,
            team_name: finalTeamName,
            nickname: p.nickname,
            kills: p.player_stats?.Kills ?? "",
            deaths: p.player_stats?.Deaths ?? "",
            assists: p.player_stats?.Assists ?? "",
            kd: p.player_stats?.KDRatio ?? "",
            kr: p.player_stats?.KRRatio ?? "",
            hs_pct: p.player_stats?.Headshots ?? "",
            mvps: p.player_stats?.MVPs ?? "",
          });
        }
      }
    }
  }

  // CSVs
  const standingsCsv = stringify(
    standings.map((s: any) => ({
      position: s.position ?? s.rank ?? "",
      team_id: s.team?.team_id ?? s.entity_id ?? "",
      team_name: s.team?.name ?? s.entity_name ?? "",
      points: s.points ?? s.score ?? "",
      wins: s.wins ?? "",
      losses: s.losses ?? "",
    })),
    { header: true },
  );

  const teamsCsv = stringify(
    teamsDetailed.map((t: any) => ({
      team_id: t.team_id,
      team_name: t.name,
      created_at: t.creation_date,
    })),
    { header: true },
  );

  const playersCsv = stringify(players, { header: true });

  // Division-wide per-team per-player aggregates (new aggregate file; does not modify originals)
  const allPplAgg: Record<
    string,
    {
      team_id: string;
      team_name: string;
      nickname: string;
      maps: number;
      kills: number;
      deaths: number;
      assists: number;
      mvps: number;
      krSum: number;
      krN: number;
      hsSum: number;
      hsN: number;
    }
  > = {};
  for (const ln of lines) {
    const key = `${ln.team_id}::${ln.nickname}`;
    const e = (allPplAgg[key] ||= {
      team_id: ln.team_id || "",
      team_name: (ln.team_name ||
        (ln.team_id ? teamNameById.get(ln.team_id) || "" : "")) as string,
      nickname: ln.nickname,
      maps: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      mvps: 0,
      krSum: 0,
      krN: 0,
      hsSum: 0,
      hsN: 0,
    });
    e.maps += 1;
    e.kills += Number(ln.kills) || 0;
    e.deaths += Number(ln.deaths) || 0;
    e.assists += Number(ln.assists) || 0;
    e.mvps += Number(ln.mvps) || 0;
    const kr = Number(ln.kr);
    if (!Number.isNaN(kr)) {
      e.krSum += kr;
      e.krN += 1;
    }
    const hs = Number(String(ln.hs_pct).toString().replace("%", ""));
    if (!Number.isNaN(hs)) {
      e.hsSum += hs;
      e.hsN += 1;
    }
  }
  const teamPlayersAggRows = Object.values(allPplAgg).map((v) => ({
    team_id: v.team_id,
    team_name: v.team_name,
    nickname: v.nickname,
    maps_played: v.maps,
    kills: v.kills,
    deaths: v.deaths,
    assists: v.assists,
    kd: Number((v.deaths > 0 ? v.kills / v.deaths : v.kills).toFixed(2)),
    kr_avg: Number((v.krN > 0 ? v.krSum / v.krN : 0).toFixed(2)),
    hs_pct_avg: Number((v.hsN > 0 ? v.hsSum / v.hsN : 0).toFixed(2)),
    mvps: v.mvps,
  }));

  const matchesCsv = stringify(
    withStats.map((m: any) => {
      const ts = extractTeamsBasic(m.teams);
      return {
        match_id: m.match_id,
        scheduled_at: m.scheduled_at,
        finished_at: m.finished_at,
        map: m.voting?.map?.pick?.[0] ?? "",
        team1_id: ts?.[0]?.team_id ?? "",
        team1_name:
          ts?.[0]?.name ??
          (ts?.[0]?.team_id ? teamNameById.get(ts?.[0]?.team_id) || "" : ""),
        team2_id: ts?.[1]?.team_id ?? "",
        team2_name:
          ts?.[1]?.name ??
          (ts?.[1]?.team_id ? teamNameById.get(ts?.[1]?.team_id) || "" : ""),
        result_winner: m.results?.winner ?? "",
      };
    }),
    { header: true },
  );

  const matchPlayersCsv = stringify(lines, { header: true });

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(`${OUT_DIR}/standings.csv`, standingsCsv);
  await fs.writeFile(`${OUT_DIR}/teams.csv`, teamsCsv);
  await fs.writeFile(`${OUT_DIR}/players.csv`, playersCsv);
  await fs.writeFile(`${OUT_DIR}/matches.csv`, matchesCsv);
  await fs.writeFile(`${OUT_DIR}/match_players.csv`, matchPlayersCsv);
  await fs.writeFile(
    `${OUT_DIR}/team_players_agg.csv`,
    stringify(teamPlayersAggRows, { header: true }),
  );

  if (MY_TEAM_ID) {
    // Roster: prefer /teams/{id} members; fallback to stats-derived nicknames
    let rosterPlayers = players.filter((p) => p.team_id === MY_TEAM_ID);
    if (rosterPlayers.length === 0) {
      const statsLinesForTeam = lines.filter(
        (ln: any) => ln.team_id === MY_TEAM_ID,
      );
      const teamNameFromStats =
        teamNameById.get(MY_TEAM_ID) ||
        (statsLinesForTeam.find((ln: any) => ln.team_name)?.team_name ?? "");
      const nickSet = new Set<string>(
        statsLinesForTeam.map((ln: any) => String(ln.nickname)),
      );
      rosterPlayers = [...nickSet].map((nickname) => ({
        team_id: MY_TEAM_ID,
        team_name: teamNameFromStats,
        player_id: "",
        nickname,
        role: "",
      }));
    }
    const myPlayersCsv = stringify(rosterPlayers, { header: true });

    // Partition upcoming vs finished for my team
    const { upcoming, finished } = splitTeamMatches(withStats, MY_TEAM_ID);
    const mapMatch = (m: any) => {
      const ts = extractTeamsBasic(m.teams);
      return {
        match_id: m.match_id,
        scheduled_at: m.scheduled_at,
        finished_at: m.finished_at,
        team1_id: ts?.[0]?.team_id ?? "",
        team1_name: ts?.[0]?.name ?? "",
        team2_id: ts?.[1]?.team_id ?? "",
        team2_name: ts?.[1]?.name ?? "",
        result_winner: m.results?.winner ?? "",
      };
    };
    const myUpcomingCsv = stringify(upcoming.map(mapMatch), { header: true });
    const myResultsCsv = stringify(
      finished.map((m) => ({
        ...mapMatch(m),
        my_team_result: myTeamResult(m, MY_TEAM_ID),
      })),
      { header: true },
    );

    // Player stats lines: filter to my roster nicknames
    const myRosterNicknames = new Set(rosterPlayers.map((p) => p.nickname));
    const myTeamPlayerLines = lines.filter(
      (ln: any) =>
        ln.team_id === MY_TEAM_ID || myRosterNicknames.has(ln.nickname),
    );
    const myTeamPlayerCsv = stringify(myTeamPlayerLines, { header: true });

    // Aggregate my team stats per played map (across rounds)
    const myMapStats: Record<
      string,
      {
        kills: number;
        deaths: number;
        assists: number;
        krSum: number;
        krN: number;
        mvps: number;
        team_name?: string;
      }
    > = {};
    for (const ln of myTeamPlayerLines) {
      const key = `${ln.match_id}::${ln.map || ""}`;
      const e = (myMapStats[key] ||= {
        kills: 0,
        deaths: 0,
        assists: 0,
        krSum: 0,
        krN: 0,
        mvps: 0,
        team_name: ln.team_name,
      });
      const k = Number(ln.kills) || 0;
      const d = Number(ln.deaths) || 0;
      const a = Number(ln.assists) || 0;
      const kr = Number(ln.kr) || 0;
      const mvps = Number(ln.mvps) || 0;
      e.kills += k;
      e.deaths += d;
      e.assists += a;
      if (!Number.isNaN(kr)) {
        e.krSum += kr;
        e.krN += 1;
      }
      e.mvps += mvps;
      if (!e.team_name && ln.team_name) e.team_name = ln.team_name;
    }
    const myTeamMapStatsRows = Object.entries(myMapStats).map(([key, v]) => {
      const [match_id, map] = key.split("::");
      const kd = v.deaths > 0 ? v.kills / v.deaths : v.kills;
      const kr_avg = v.krN > 0 ? v.krSum / v.krN : 0;
      return {
        match_id,
        map,
        team_name: v.team_name || teamNameById.get(MY_TEAM_ID) || "",
        kills: v.kills,
        deaths: v.deaths,
        assists: v.assists,
        kd: Number(kd.toFixed(2)),
        kr_avg: Number(kr_avg.toFixed(2)),
        mvps: v.mvps,
      };
    });
    const myTeamMapStatsCsv = stringify(myTeamMapStatsRows, { header: true });

    // Veto picks/bans for matches with my team (best effort from match object)
    const myVetoRows = withStats
      .filter((m: any) => extractTeamIds(m.teams).includes(MY_TEAM_ID))
      .map((m: any) => {
        const ts = extractTeamsBasic(m.teams);
        const mv = m.voting?.map ?? {};
        const picks = Array.isArray(mv.pick) ? (mv.pick as string[]) : [];
        const bans = Array.isArray(mv.ban) ? (mv.ban as string[]) : [];
        const t1_bans = [bans[0], bans[2]].filter(Boolean).join(",");
        const t2_bans = [bans[1], bans[3]].filter(Boolean).join(",");
        const t1_pick = picks[0] ?? "";
        const t2_pick = picks[1] ?? "";
        // Compute leftover from map pool (if exactly one remains)
        const used = new Set(
          [...(bans || []), ...(picks || [])].filter(Boolean),
        );
        const leftover = mapPoolList.filter((mname) => !used.has(mname));
        const leftover_map = leftover.length === 1 ? leftover[0] : "";
        return {
          match_id: m.match_id,
          team1_name: ts?.[0]?.name ?? "",
          team2_name: ts?.[1]?.name ?? "",
          team1_bans: t1_bans,
          team2_bans: t2_bans,
          team1_pick: t1_pick,
          team2_pick: t2_pick,
          leftover_map,
          picks: picks.join(","),
          bans: bans.join(","),
          map_voting_json: JSON.stringify(m.voting?.map ?? {}),
        };
      });
    const myVetoCsv = stringify(myVetoRows, { header: true });

    // Simple overall aggregate across all played maps for my team
    const agg = myTeamMapStatsRows.reduce(
      (acc: any, r: any) => {
        acc.kills += Number(r.kills) || 0;
        acc.deaths += Number(r.deaths) || 0;
        acc.assists += Number(r.assists) || 0;
        acc.mvps += Number(r.mvps) || 0;
        acc.maps_played += 1;
        if (!acc.team_name && r.team_name) acc.team_name = r.team_name;
        return acc;
      },
      {
        kills: 0,
        deaths: 0,
        assists: 0,
        mvps: 0,
        maps_played: 0,
        team_name: "",
      },
    );
    // Compute KR average from player lines
    let krSum = 0,
      krN = 0;
    for (const ln of myTeamPlayerLines) {
      const kr = Number(ln.kr);
      if (!Number.isNaN(kr)) {
        krSum += kr;
        krN += 1;
      }
    }
    const kdOverall = agg.deaths > 0 ? agg.kills / agg.deaths : agg.kills;
    const krOverall = krN > 0 ? krSum / krN : 0;

    // Win/loss/draw from finished matches (reuse earlier split)
    let wins = 0,
      losses = 0,
      draws = 0;
    for (const m of finished) {
      const res = myTeamResult(m, MY_TEAM_ID);
      if (res === "win") wins++;
      else if (res === "loss") losses++;
      else if (res === "draw") draws++;
    }
    const myTeamOverallCsv = stringify(
      [
        {
          team_id: MY_TEAM_ID,
          team_name: agg.team_name,
          matches_total: upcoming.length + finished.length,
          matches_finished: finished.length,
          maps_played: agg.maps_played,
          wins,
          losses,
          draws,
          kills: agg.kills,
          deaths: agg.deaths,
          assists: agg.assists,
          kd: Number(kdOverall.toFixed(2)),
          kr_avg: Number(krOverall.toFixed(2)),
          mvps: agg.mvps,
        },
      ],
      { header: true },
    );

    // Per-player aggregates (for my team only)
    const roster = players.filter((p) => p.team_id === MY_TEAM_ID);
    const idByNick = new Map<string, string>();
    for (const p of roster) idByNick.set(p.nickname, p.player_id);
    const pplAgg: Record<
      string,
      {
        nickname: string;
        player_id?: string;
        team_name?: string;
        maps: number;
        kills: number;
        deaths: number;
        assists: number;
        mvps: number;
        krSum: number;
        krN: number;
        hsSum: number;
        hsN: number;
      }
    > = {};
    for (const ln of myTeamPlayerLines) {
      const key = ln.nickname as string;
      const e = (pplAgg[key] ||= {
        nickname: key,
        player_id: idByNick.get(key),
        team_name: ln.team_name,
        maps: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        mvps: 0,
        krSum: 0,
        krN: 0,
        hsSum: 0,
        hsN: 0,
      });
      e.maps += 1;
      e.kills += Number(ln.kills) || 0;
      e.deaths += Number(ln.deaths) || 0;
      e.assists += Number(ln.assists) || 0;
      e.mvps += Number(ln.mvps) || 0;
      const kr = Number(ln.kr);
      if (!Number.isNaN(kr)) {
        e.krSum += kr;
        e.krN += 1;
      }
      const hs = Number(String(ln.hs_pct).toString().replace("%", ""));
      if (!Number.isNaN(hs)) {
        e.hsSum += hs;
        e.hsN += 1;
      }
      if (!e.team_name && ln.team_name) e.team_name = ln.team_name;
    }
    const myTeamPlayersAggRows = Object.values(pplAgg).map((v) => {
      const kd = v.deaths > 0 ? v.kills / v.deaths : v.kills;
      const kr_avg = v.krN > 0 ? v.krSum / v.krN : 0;
      const hs_pct_avg = v.hsN > 0 ? v.hsSum / v.hsN : 0;
      return {
        player_id: v.player_id ?? "",
        nickname: v.nickname,
        team_name: v.team_name || teamNameById.get(MY_TEAM_ID) || "",
        maps_played: v.maps,
        kills: v.kills,
        deaths: v.deaths,
        assists: v.assists,
        kd: Number(kd.toFixed(2)),
        kr_avg: Number(kr_avg.toFixed(2)),
        hs_pct_avg: Number(hs_pct_avg.toFixed(2)),
        mvps: v.mvps,
      };
    });
    const myTeamPlayersAggCsv = stringify(myTeamPlayersAggRows, {
      header: true,
    });

    // Per-opponent breakdown (matches only)
    const vsAgg: Record<
      string,
      {
        opponent_id: string;
        opponent_name: string;
        played: number;
        wins: number;
        losses: number;
        draws: number;
      }
    > = {};
    for (const m of withStats.filter((mm: any) =>
      extractTeamIds(mm.teams).includes(MY_TEAM_ID),
    )) {
      const ts = extractTeamsBasic(m.teams);
      const opp = ts.find((t) => t.team_id !== MY_TEAM_ID);
      const oppId = opp?.team_id ?? "";
      const oppName = opp?.name ?? "";
      const key = oppId || oppName || "unknown";
      const e = (vsAgg[key] ||= {
        opponent_id: oppId,
        opponent_name: oppName,
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      });
      e.played += 1;
      const res = myTeamResult(m, MY_TEAM_ID);
      if (res === "win") e.wins += 1;
      else if (res === "loss") e.losses += 1;
      else if (res === "draw") e.draws += 1;
    }
    const myTeamVsOpponentsCsv = stringify(Object.values(vsAgg), {
      header: true,
    });

    await fs.writeFile(`${OUT_DIR}/my_team_players.csv`, myPlayersCsv);
    await fs.writeFile(`${OUT_DIR}/my_team_upcoming.csv`, myUpcomingCsv);
    await fs.writeFile(`${OUT_DIR}/my_team_results.csv`, myResultsCsv);
    await fs.writeFile(`${OUT_DIR}/my_team_match_players.csv`, myTeamPlayerCsv);
    await fs.writeFile(`${OUT_DIR}/my_team_map_stats.csv`, myTeamMapStatsCsv);
    await fs.writeFile(`${OUT_DIR}/my_team_veto.csv`, myVetoCsv);
    await fs.writeFile(
      `${OUT_DIR}/my_team_stats_overall.csv`,
      myTeamOverallCsv,
    );
    await fs.writeFile(
      `${OUT_DIR}/my_team_players_agg.csv`,
      myTeamPlayersAggCsv,
    );
    await fs.writeFile(
      `${OUT_DIR}/my_team_vs_opponents.csv`,
      myTeamVsOpponentsCsv,
    );
  }

  console.log(
    `Done.\n  Organizer: ${ORG_ID ?? ORG_NAME}\n  Championship: ${championship.name} (${championshipId})\n  Leaderboard: ${chosenLb?.name ?? "(by group)"} (group ${groupIndex})\n  Teams: ${teamIds.length}\n  Matches: ${withStats.length}${MY_TEAM_ID ? `\n  My team: ${MY_TEAM_ID}` : ""}\n  CSVs in ./${OUT_DIR}`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
