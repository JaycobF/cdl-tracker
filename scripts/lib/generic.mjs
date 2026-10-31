// Keeps a rolling list of recent and upcoming matches for a league without a hand-built schedule
// (League of Legends, CS2, Dota 2). Calls the source only when it's time to, to stay inside the plan's limits.
import { listFrom, normalizeMatch, isFinal } from "./normalize.mjs";

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const KEEP_PAST = 21 * DAY, KEEP_FUTURE = 21 * DAY, MAX_ROWS = 400;

export const emptyStore = id => ({ id, updated: null, upcomingFetched: null, recentFetched: null, matches: [] });

const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** What this league needs right now: { upcoming: bool, recent: bool, due: number } */
export function plan(league, store, { now, planName = "free", force = false }) {
  const every = (league.checkEveryMinutes?.[planName] ?? 480) * MIN;
  const upEvery = (league.upcomingEveryHours?.[planName] ?? 24) * HOUR;
  const t = now.getTime();
  const due = store.matches.filter(m => m.status !== "completed" && m.at && new Date(m.at).getTime() < t - 45 * MIN && new Date(m.at).getTime() > t - 3 * DAY).length;
  const since = s => (s ? t - new Date(s).getTime() : Infinity);
  return {
    upcoming: force || since(store.upcomingFetched) >= upEvery,
    recent: force || !store.recentFetched || (due > 0 && since(store.recentFetched) >= every),
    due
  };
}

function toRow(n, fallbackStatus) {
  const final = isFinal(n);
  const status = final ? "completed" : (n.status !== "unknown" ? n.status : fallbackStatus);
  return {
    id: n.id || "",
    at: n.at ? n.at.toISOString() : null,
    a: { name: n.a.name, short: n.a.short || "", ...(n.a.logo ? { logo: n.a.logo } : {}) },
    b: { name: n.b.name, short: n.b.short || "", ...(n.b.logo ? { logo: n.b.logo } : {}) },
    sa: n.a.score, sb: n.b.score,
    status, event: n.event || "", bestOf: n.bestOf ?? null
  };
}

/** Merges fetched matches into the store. Returns the number of rows added or changed. */
export function mergeInto(store, payload, fallbackStatus, now) {
  const list = listFrom(payload).map(normalizeMatch).filter(n => n.a?.name && n.b?.name);
  let changed = 0;
  for (const n of list) {
    const row = toRow(n, fallbackStatus);
    if (row.status !== "completed") { row.sa = row.status === "live" ? row.sa : null; row.sb = row.status === "live" ? row.sb : null; }
    let i = row.id ? store.matches.findIndex(m => m.id === row.id) : -1;
    if (i < 0) {
      // The same match can carry different ids on different endpoints: match on teams and start time.
      const pair = [key(row.a.name), key(row.b.name)].sort().join("|");
      i = store.matches.findIndex(m => [key(m.a.name), key(m.b.name)].sort().join("|") === pair &&
        (!m.at || !row.at || Math.abs(new Date(m.at) - new Date(row.at)) < 4 * HOUR));
    }
    if (i < 0) { store.matches.push(row); changed++; continue; }
    const old = store.matches[i];
    if (old.status === "completed" && row.status !== "completed") continue; // never downgrade a result
    let next = { ...old, ...row, id: old.id || row.id };
    if (key(old.a.name) === key(row.b.name) && key(old.a.name) !== key(row.a.name)) {
      // Source listed the teams the other way round: keep our original order.
      next = { ...next, a: old.a, b: old.b, sa: row.sb, sb: row.sa };
    }
    if (JSON.stringify(next) !== JSON.stringify(old)) { store.matches[i] = next; changed++; }
  }
  const t = now.getTime();
  const before = store.matches.length;
  store.matches = store.matches
    .filter(m => {
      if (!m.at) return false;
      const at = new Date(m.at).getTime();
      if (at < t - KEEP_PAST || at > t + KEEP_FUTURE) return false;
      if (m.status !== "completed" && at < t - 3 * DAY) return false; // never finished, probably cancelled
      return true;
    })
    .sort((x, y) => String(x.at).localeCompare(String(y.at)))
    .slice(-MAX_ROWS);
  return changed + (before - store.matches.length);
}
