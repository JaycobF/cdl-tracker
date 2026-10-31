// Talks to Cito API (https://citoapi.com), an independent esports data API.
// Set FIXTURE_DIR to read saved responses from disk instead (used by the tests):
// a request for /cs2/matches/recent?limit=50 reads FIXTURE_DIR/cs2__matches__recent.json.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.CITO_API_BASE || "https://api.citoapi.com/api/v1";

export class SourceError extends Error {
  constructor(message, { fatal = false } = {}) { super(message); this.fatal = fatal; }
}

let calls = 0;
export const callCount = () => calls;

async function getOne(p, { apiKey, fetchImpl = fetch }) {
  if (process.env.FIXTURE_DIR) {
    const file = path.join(process.env.FIXTURE_DIR, p.split("?")[0].replace(/^\//, "").replace(/\//g, "__") + ".json");
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    calls++;
    return { ok: true, body: JSON.parse(fs.readFileSync(file, "utf8")) };
  }
  if (!apiKey) throw new SourceError("CITO_API_KEY is not set. Add it as a repository secret (see README).", { fatal: true });
  calls++;
  const res = await fetchImpl(BASE + p, { headers: { "x-api-key": apiKey, accept: "application/json", "user-agent": "esports-tracker (fan project)" } });
  if (res.status === 401 || res.status === 403) throw new SourceError(`Source refused the API key (HTTP ${res.status}). Check the CITO_API_KEY secret.`, { fatal: true });
  if (res.status === 429) throw new SourceError("Source rate limit reached (HTTP 429). The next scheduled run will try again.", { fatal: true });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}

/** Tries each path in turn and returns the first successful JSON body. */
export async function fetchFirst(paths, opts = {}) {
  const log = opts.log || console.log;
  let last = "no paths";
  for (const raw of paths) {
    const p = raw.trim();
    try {
      const r = await getOne(p, { apiKey: process.env.CITO_API_KEY, ...opts });
      if (r.ok) { log(`  ${p}: OK`); return r.body; }
      last = `HTTP ${r.status}`; log(`  ${p}: HTTP ${r.status}, trying next`);
    } catch (e) {
      if (e.fatal) throw e;
      last = e.message; log(`  ${p}: ${e.message}`);
    }
  }
  throw new SourceError(`No source path answered (${last}).`);
}

/** CDL: recent matches across the league. */
export const fetchRecentMatches = (opts = {}) =>
  fetchFirst((process.env.CITO_PATHS || "/cod/matches/recent?limit=50,/cod/matches?limit=50").split(","), opts);
