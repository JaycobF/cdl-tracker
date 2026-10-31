#!/usr/bin/env node
// Pulls finished CDL series from the data source and writes them to public/data/results.json.
// Usage:
//   node scripts/update-scores.mjs                 normal run (skips the API when nothing is due)
//   node scripts/update-scores.mjs --force         call the API even if nothing is due
//   node scripts/update-scores.mjs --fixture f.json --now 2027-01-16T03:00:00Z   offline test with a saved response
//   node scripts/update-scores.mjs --dry-run       show what would change without writing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFrom, normalizeMatch } from "./lib/normalize.mjs";
import { applyResults, dueMatches, activeEvent } from "./lib/apply.mjs";
import { fetchRecentMatches } from "./lib/source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || path.join(root, "public", "data");
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return d; } };
const schedule = read("schedule.json");
const results = read("results.json", { updated: null, matches: {}, extra: [], winners: {} });
const overrides = read("overrides.json", { matches: {}, winners: {} });
const now = opt("--now") ? new Date(opt("--now")) : new Date();

function setOutput(k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); }

const due = dueMatches(schedule, results, overrides, now);
const ev = activeEvent(schedule, now);
console.log(`${now.toISOString()}  ${due.length} scheduled series awaiting a score${ev ? `, ${ev.k} window open` : ""}`);
if (!due.length && !ev && !flag("--force") && !opt("--fixture")) {
  console.log("Nothing due. No API call made.");
  setOutput("changed", "false");
  process.exit(0);
}

let payload;
try {
  payload = opt("--fixture")
    ? JSON.parse(fs.readFileSync(opt("--fixture"), "utf8"))
    : await fetchRecentMatches({ apiKey: process.env.CITO_API_KEY });
} catch (e) {
  console.error(`Could not fetch results: ${e.message}`);
  setOutput("changed", "false");
  process.exit(1);
}

const list = listFrom(payload);
const normalized = list.map(normalizeMatch);
const recognised = normalized.filter(n => n.a?.code && n.b?.code).length;
console.log(`Source returned ${list.length} matches, ${recognised} between CDL teams.`);
if (list.length && !recognised) console.warn("None of the team names were recognised. Run `npm run check-source` and add aliases in scripts/lib/teams.mjs.");

const next = applyResults(schedule, results, normalized, now);

// A LAN event's winner is the team that won its last series, once the event is over.
const winners = { ...(results.winners || {}) };
for (const e of schedule.events) {
  if (winners[e.id] || overrides.winners?.[e.id] || now < new Date(e.end)) continue;
  const inEvent = next.extra.filter(x => x.at && new Date(x.at) >= new Date(e.start) && new Date(x.at) <= new Date(e.end));
  const last = inEvent.sort((x, y) => new Date(y.at) - new Date(x.at))[0];
  if (last && last.sa !== last.sb && e.lan) {
    winners[e.id] = { team: last.sa > last.sb ? last.a : last.b, src: "auto" };
    next.changed++;
    console.log(`${e.k} winner: ${winners[e.id].team}`);
  }
}

if (!next.changed) {
  console.log("No new results.");
  setOutput("changed", "false");
  process.exit(0);
}
const out = { updated: now.toISOString(), source: "Cito API", matches: next.matches, extra: next.extra, winners };
for (const [id, r] of Object.entries(next.matches)) if (!results.matches?.[id] || results.matches[id].sa !== r.sa || results.matches[id].sb !== r.sb) {
  const m = schedule.matches.find(x => x.id === id);
  console.log(`  ${id}: ${m.a} ${r.sa}–${r.sb} ${m.b}`);
}
if (flag("--dry-run")) { console.log(`Dry run: ${next.changed} change(s) not written.`); process.exit(0); }
fs.writeFileSync(path.join(dataDir, "results.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${next.changed} change(s) to results.json.`);
setOutput("changed", "true");
