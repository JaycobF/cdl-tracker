// Fetches recent CDL matches from Cito API (https://citoapi.com), an independent esports data API.
// To use a different source, export a function with the same signature that returns an array of match objects.
const BASE = process.env.CITO_API_BASE || "https://api.citoapi.com/api/v1";
const PATHS = (process.env.CITO_PATHS || "/cod/matches/recent?limit=50,/cod/matches?limit=50").split(",");

export async function fetchRecentMatches({ apiKey, fetchImpl = fetch, log = console.log }) {
  if (!apiKey) throw new Error("CITO_API_KEY is not set. Add it as a repository secret (see README).");
  let lastErr;
  for (const p of PATHS) {
    const url = BASE + p.trim();
    try {
      const res = await fetchImpl(url, { headers: { "x-api-key": apiKey, accept: "application/json", "user-agent": "cdl-tracker (fan project)" } });
      if (res.status === 401 || res.status === 403) throw new Error(`Source refused the API key (HTTP ${res.status}). Check the CITO_API_KEY secret.`);
      if (res.status === 429) throw new Error("Source rate limit reached (HTTP 429). The next scheduled run will try again.");
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} from ${p}`); log(`  ${p}: HTTP ${res.status}, trying next`); continue; }
      const body = await res.json();
      log(`  ${p}: OK`);
      return body;
    } catch (e) {
      if (/API key|rate limit/.test(e.message)) throw e;
      lastErr = e; log(`  ${p}: ${e.message}`);
    }
  }
  throw lastErr || new Error("No source path answered.");
}
