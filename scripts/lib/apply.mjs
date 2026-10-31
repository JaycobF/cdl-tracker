// Matches finished series from the data source to the season schedule and records the scores.
import { isFinal } from "./normalize.mjs";

const HOUR = 3600e3;
const WINDOW = 20 * HOUR; // a source's start time may differ from the published one (delays, time zones)

/** Scheduled matches that should have finished but have no score yet. */
export function dueMatches(schedule, results, overrides, now = new Date()) {
  return schedule.matches.filter(m => {
    if (results.matches?.[m.id] || overrides.matches?.[m.id]) return false;
    const t = new Date(m.at).getTime();
    return t < now.getTime() - 1 * HOUR && t > now.getTime() - 14 * 24 * HOUR;
  });
}

/** The LAN event happening now, or that ended within the last day, if any. */
export function activeEvent(schedule, now = new Date()) {
  return schedule.events.find(e => {
    const s = new Date(e.start).getTime(), en = new Date(e.end).getTime();
    return now.getTime() >= s - 6 * HOUR && now.getTime() <= en + 24 * HOUR;
  }) || null;
}

export function applyResults(schedule, results, normalized, now = new Date()) {
  const out = {
    matches: { ...(results.matches || {}) },
    extra: [...(results.extra || [])]
  };
  let changed = 0;
  const used = new Set();
  for (const n of normalized) {
    if (!isFinal(n) || !n.a.code || !n.b.code || n.a.code === n.b.code) continue;
    const pair = m => (m.a === n.a.code && m.b === n.b.code) || (m.a === n.b.code && m.b === n.a.code);
    let cands = schedule.matches.filter(m => pair(m) && !used.has(m.id) && new Date(m.at).getTime() < now.getTime() + HOUR);
    if (n.at) cands = cands.filter(m => Math.abs(new Date(m.at) - n.at) <= WINDOW);
    else cands = cands.filter(m => !out.matches[m.id]).sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 1);
    const m = cands.sort((x, y) => Math.abs(new Date(x.at) - (n.at || now)) - Math.abs(new Date(y.at) - (n.at || now)))[0];
    if (m) {
      used.add(m.id);
      const sa = m.a === n.a.code ? n.a.score : n.b.score;
      const sb = m.a === n.a.code ? n.b.score : n.a.score;
      const prev = out.matches[m.id];
      if (!prev || prev.sa !== sa || prev.sb !== sb) {
        out.matches[m.id] = { sa, sb, src: "auto", recorded: now.toISOString() };
        changed++;
      }
      continue;
    }
    // Not a scheduled qualifier: keep it as another result (Major brackets, Champs, Kickoff),
    // but only for this season and only when we know when it was played.
    const seasonStart = new Date(schedule.events[0].start).getTime() - 7 * 24 * HOUR;
    if (!n.at || n.at.getTime() < seasonStart) continue;
    const key = n.id || `${(n.at || now).toISOString().slice(0, 10)}-${n.a.code}-${n.b.code}`;
    const row = { id: key, at: n.at ? n.at.toISOString() : null, a: n.a.code, b: n.b.code, sa: n.a.score, sb: n.b.score, event: n.event || "" };
    const i = out.extra.findIndex(x => x.id === key);
    if (i < 0) { out.extra.push(row); changed++; }
    else if (out.extra[i].sa !== row.sa || out.extra[i].sb !== row.sb) { out.extra[i] = row; changed++; }
  }
  out.extra.sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return { ...out, changed };
}
