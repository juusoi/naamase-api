import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const BASE = "https://open.faceit.com/data/v4";

const HEADERS = {
  Authorization: `Bearer ${process.env.FACEIT_API_KEY}`,
  Accept: "application/json",
};

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Fetch JSON from the FACEIT Data API, retrying with backoff on 429.
export async function faceitFetch(url: string): Promise<any> {
  let attempt = 0;
  while (true) {
    const r = await fetch(url, { headers: HEADERS });
    if (r.ok) return r.json();
    if (r.status === 429 && attempt < 5) {
      const ra = r.headers.get("retry-after");
      const reset = r.headers.get("ratelimit-reset");
      const waitMs = ra
        ? Number(ra) * 1000
        : reset
          ? Number(reset) * 1000
          : 500 * (attempt + 1);
      await sleep(waitMs);
      attempt++;
      continue;
    }
    let body: string;
    try {
      body = await r.text();
    } catch {
      body = ""; // keep empty body if text read fails
    }
    throw new Error(`${r.status} ${url}${body ? `\n${body}` : ""}`);
  }
}

// Disk-cached variant: successful responses are cached by URL hash under cacheDir.
// Useful for the long, paginated history crawls where reruns should not re-hit the API.
export async function faceitFetchCached(
  url: string,
  cacheDir = "raw",
): Promise<any> {
  await mkdir(cacheDir, { recursive: true });
  const key = createHash("sha256").update(url).digest("hex");
  const cachePath = `${cacheDir}/${key}.json`;
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    /* cache miss */
  }
  const data = await faceitFetch(url);
  await writeFile(cachePath, JSON.stringify(data));
  await sleep(200);
  return data;
}
