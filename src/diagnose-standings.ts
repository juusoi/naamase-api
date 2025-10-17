import "dotenv/config";
import { getChampionshipIdByName } from "./faceit-helpers";

const BASE = "https://open.faceit.com/data/v4";
const H = {
  Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
  Accept: "application/json",
};

type Cfg = Partial<{
  "org-id": string;
  "org-name": string;
  "champ-id": string;
  "champ-name": string;
  "lb-id": string;
  "lb-group": number | string;
  "game-id": string;
}>;

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1] as string | undefined;
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out as { config?: string } & Record<string, string | boolean>;
}

async function loadConfig(path?: string): Promise<Cfg> {
  const fs = await import("node:fs/promises");
  const candidate = path ?? "faceit.config.json";
  try {
    const raw = await fs.readFile(candidate, "utf8");
    return JSON.parse(raw) as Cfg;
  } catch {
    return {};
  }
}

async function req(
  path: string,
  params?: Record<string, string | number | undefined>,
) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {}))
    if (v !== undefined) u.searchParams.set(k, String(v));
  const r = await fetch(u.toString(), { headers: H });
  const bodyText = await r.text();
  const hdrs: Record<string, string> = {};
  r.headers.forEach((v, k) => (hdrs[k] = v));
  return {
    ok: r.ok,
    status: r.status,
    url: u.toString(),
    headers: hdrs,
    body: bodyText,
  };
}

function print(title: string, out: any) {
  const head = {
    status: out.status,
    url: out.url,
    headers: {
      "x-faceit-gateway": out.headers["x-faceit-gateway"],
      "ratelimit-limit": out.headers["ratelimit-limit"],
      "ratelimit-remaining": out.headers["ratelimit-remaining"],
      "ratelimit-reset": out.headers["ratelimit-reset"],
      "cache-control": out.headers["cache-control"],
    },
  };
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(head, null, 2));
  const snippet = (out.body || "").slice(0, 600);
  console.log(snippet);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await loadConfig(args.config as string | undefined);

  let champId = (cfg["champ-id"] || process.env.FACEIT_CHAMPIONSHIP_ID) as
    | string
    | undefined;
  const lbId = (cfg["lb-id"] || process.env.FACEIT_LB_ID) as string | undefined;
  const lbGroupRaw = (cfg["lb-group"] || process.env.FACEIT_LB_GROUP) as
    | string
    | number
    | undefined;
  const lbGroup =
    typeof lbGroupRaw === "string" ? parseInt(lbGroupRaw, 10) : lbGroupRaw;

  if (!champId) {
    const orgId = (cfg["org-id"] || process.env.FACEIT_ORGANIZER_ID) as
      | string
      | undefined;
    const champName = (cfg["champ-name"] || process.env.FACEIT_CHAMP_NAME) as
      | string
      | undefined;
    const gameId = (cfg["game-id"] ||
      process.env.FACEIT_GAME_ID ||
      "cs2") as string;
    if (orgId && champName) {
      try {
        champId = await getChampionshipIdByName(orgId, champName, gameId);
        console.log(
          `Resolved championship id: ${champId} (from name "${champName}")`,
        );
      } catch (e) {
        console.error(
          "Failed to resolve championship id from name. Provide champ-id in config or env.",
        );
      }
    }
  }

  if (!champId) {
    console.error(
      "Missing championship id. Set champ-id in config or FACEIT_CHAMPIONSHIP_ID (or ensure org-id + champ-name present).",
    );
    process.exit(1);
  }

  // 0) List leaderboards
  const l = await req(`/leaderboards/championships/${champId}`, {
    limit: 100,
    offset: 0,
  });
  print("leaderboards/championships/{championship_id}", l);

  // Extract first id/group for convenience
  let firstLbId: string | undefined;
  let firstGroup: number | undefined;
  try {
    const json = JSON.parse(l.body);
    const it = (json.items ?? [])[0];
    firstLbId = it?.leaderboard_id;
    firstGroup = it?.group;
  } catch (e) {
    // ignore JSON parse
  }

  // 1) standings via group
  const groupsToTry = [lbGroup, firstGroup, 0, 1].filter(
    (v) => typeof v === "number",
  ) as number[];
  for (const g of groupsToTry) {
    const g1 = await req(`/leaderboards/championships/${champId}/groups/${g}`, {
      limit: 20,
      offset: 0,
    });
    print(`groups/${g} limit+offset`, g1);
    const g2 = await req(`/leaderboards/championships/${champId}/groups/${g}`);
    print(`groups/${g} no params`, g2);
  }

  // 2) standings via leaderboard_id (if provided or discovered)
  const idToTry = [lbId, firstLbId].filter(Boolean) as string[];
  for (const id of idToTry) {
    const s1 = await req(`/leaderboards/${id}/standings`, {
      limit: 20,
      offset: 0,
    });
    print(`leaderboards/${id}/standings limit+offset`, s1);
    const s2 = await req(`/leaderboards/${id}/standings`);
    print(`leaderboards/${id}/standings no params`, s2);
    const s3 = await req(`/leaderboards/${id}`, { limit: 20, offset: 0 });
    print(`leaderboards/${id} limit+offset`, s3);
    const s4 = await req(`/leaderboards/${id}`);
    print(`leaderboards/${id} no params`, s4);
  }

  console.log(
    "\nDiagnosis complete. Share the outputs above; we can adjust the code based on any 2xx you see.",
  );
})();
