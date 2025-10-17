import 'dotenv/config';
import { getOrganizerIdByName, getChampionshipIdByName } from './faceit-helpers';

type CliArgs = { config?: string } & Record<string, string | boolean>;

function parseArgs(argv: string[]): CliArgs {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1] as string | undefined;
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out as CliArgs;
}

async function loadConfig(path?: string) {
  const fs = await import('node:fs/promises');
  const candidate = path ?? 'faceit.config.json';
  try {
    const raw = await fs.readFile(candidate, 'utf8');
    return { json: JSON.parse(raw), path: candidate } as { json: any; path: string };
  } catch {
    return { json: {}, path: candidate } as { json: any; path: string };
  }
}

async function saveConfig(path: string, json: any) {
  const fs = await import('node:fs/promises');
  const pretty = JSON.stringify(json, null, 2) + '\n';
  await fs.writeFile(path, pretty, 'utf8');
}

const BASE = 'https://open.faceit.com/data/v4';
const H = { Authorization: `Bearer ${process.env.FACEIT_API_KEY}`, Accept: 'application/json' };

async function req(u: string) {
  const r = await fetch(u, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
}

function lbNameOf(x: any): string {
  return (x?.leaderboard_name ?? x?.name ?? x?.title ?? '') as string;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const { json: cfg, path } = await loadConfig(args.config as string | undefined);

  const apiKey = (process.env.FACEIT_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 10) {
    console.error('FACEIT_API_KEY missing or invalid. Add it to .env (git-ignored).');
    process.exit(1);
  }

  let changed = false;
  const gameId = (cfg['game-id'] as string) || 'cs2';

  // Resolve organizer_id
  if (!cfg['org-id'] && cfg['org-name']) {
    try {
      cfg['org-id'] = await getOrganizerIdByName(cfg['org-name']);
      changed = true;
      console.log(`Resolved org-id: ${cfg['org-id']} (${cfg['org-name']})`);
    } catch (e) {
      console.warn('Could not resolve org-id from org-name. Provide org-id explicitly.');
    }
  }

  // Resolve championship_id
  if (!cfg['champ-id'] && cfg['champ-name'] && cfg['org-id']) {
    try {
      cfg['champ-id'] = await getChampionshipIdByName(cfg['org-id'], cfg['champ-name'], gameId);
      changed = true;
      console.log(`Resolved champ-id: ${cfg['champ-id']} (${cfg['champ-name']})`);
    } catch (e) {
      console.warn('Could not resolve champ-id from champ-name. Provide champ-id explicitly.');
    }
  }

  // Resolve leaderboard_id from championship
  if (!cfg['lb-id'] && cfg['champ-id']) {
    try {
      const url = new URL(`${BASE}/leaderboards/championships/${cfg['champ-id']}`);
      url.searchParams.set('limit', '100');
      url.searchParams.set('offset', '0');
      const data = (await req(url.toString())) as { items?: any[] };
      const items = data.items ?? [];
      // Candidate selection order: exact lb-name, lb-group, lb-pattern, single item
      let chosen: any | undefined;
      if (cfg['lb-name']) {
        chosen = items.find((it) => lbNameOf(it).trim() === cfg['lb-name']) ||
          items.find((it) => lbNameOf(it).includes(cfg['lb-name']));
      }
      if (!chosen && (cfg['lb-group'] || cfg['lb-group'] === 0)) {
        const g = typeof cfg['lb-group'] === 'string' ? parseInt(cfg['lb-group'], 10) : cfg['lb-group'];
        if (!Number.isNaN(g as number)) chosen = items.find((it) => it.group === g);
      }
      if (!chosen && cfg['lb-pattern']) {
        try {
          const re = new RegExp(String(cfg['lb-pattern']), 'i');
          chosen = items.find((it) => re.test(lbNameOf(it)));
        } catch {}
      }
      if (!chosen && items.length === 1) chosen = items[0];
      if (chosen?.leaderboard_id) {
        cfg['lb-id'] = chosen.leaderboard_id;
        if (!cfg['lb-group'] && typeof chosen.group === 'number') cfg['lb-group'] = chosen.group;
        changed = true;
        console.log(`Resolved lb-id: ${cfg['lb-id']} (${lbNameOf(chosen) || 'Group ' + chosen.group})`);
      } else {
        console.log('Available leaderboards:', items.map((it) => ({ id: it.leaderboard_id, group: it.group, name: lbNameOf(it) })));
        console.warn('Could not determine lb-id automatically. Provide lb-id or lb-name/lb-group/lb-pattern.');
      }
    } catch (e) {
      console.warn('Failed to list championship leaderboards. Provide lb-id explicitly.');
    }
  }

  if (changed) {
    await saveConfig(path, cfg);
    console.log(`Saved updates → ${path}`);
  } else {
    console.log('No changes needed. Config looks complete.');
  }
})();

