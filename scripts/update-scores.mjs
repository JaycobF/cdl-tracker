#!/usr/bin/env node
// Pulls new results for every league in public/data/leagues.json and writes them to public/data.
// Usage:
//   node scripts/update-scores.mjs                    normal run: only calls the API when a league is due
//   node scripts/update-scores.mjs --force            check every league now
//   node scripts/update-scores.mjs --league cs2       only this league
//   node scripts/update-scores.mjs --dry-run          show what would change without writing
//   node scripts/update-scores.mjs --fixture f.json --now 2027-01-16T03:00:00Z   CDL offline test with a saved response
//   FIXTURE_DIR=test/fixtures/api node scripts/update-scores.mjs --force         every league from saved responses
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFrom, normalizeMatch } from "./lib/normalize.mjs";
import { applyResults, dueMatches, activeEvent } from "./lib/apply.mjs";
import { fetchRecentMatches, fetchFirst, callCount } from "./lib/source.mjs";
import { emptyStore, plan, mergeInto } from "./lib/generic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_DIR || path.join(root, "public", "data");
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const now = opt("--now") ? new Date(opt("--now")) : new Date();
const force = flag("--force"), dry = flag("--dry-run"), only = opt("--league");

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return d; } };
const pending = new Map(); // file -> object to write
const write = (f, obj) => pending.set(f, obj);
function setOutput(k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); }

const config = read("leagues.json", { plan: "free", monthlyCallLimit: 480, leagues: [{ id: "cdl", type: "cdl" }] });
const month = now.toISOString().slice(0, 7);
const usage0 = read("usage.json", { month, calls: 0 });
const usedBefore = usage0.month === month ? usage0.calls : 0;
const budgetLeft = () => config.monthlyCallLimit - usedBefore - callCount();
let failures = 0;

// ---------- CDL: fixed schedule, scores matched to it ----------
async function runCdl() {
  const schedule = read("schedule.json");
  const results = read("results.json", { updated: null, matches: {}, extra: [], winners: {} });
  const overrides = read("overrides.json", { matches: {}, winners: {} });
  const due = dueMatches(schedule, results, overrides, now);
  const ev = activeEvent(schedule, now);
  console.log(`\nCDL: ${due.length} scheduled series awaiting a score${ev ? `, ${ev.k} window open` : ""}`);
  if (!due.length && !ev && !force && !opt("--fixture")) { console.log("  Nothing due. No API call made."); return; }
  if (!opt("--fixture") && budgetLeft() < 1) { console.log("  Monthly call limit reached. Skipping."); return; }

  const payload = opt("--fixture") ? JSON.parse(fs.readFileSync(opt("--fixture"), "utf8")) : await fetchRecentMatches();
  const list = listFrom(payload), normalized = list.map(normalizeMatch);
  const recognised = normalized.filter(n => n.a?.code && n.b?.code).length;
  console.log(`  Source returned ${list.length} matches, ${recognised} between CDL teams.`);
  if (list.length && !recognised) console.warn("  None of the team names were recognised. Run `npm run check-source` and add aliases in scripts/lib/teams.mjs.");

  const next = applyResults(schedule, results, normalized, now);
  const winners = { ...(results.winners || {}) };
  for (const e of schedule.events) {
    if (winners[e.id] || overrides.winners?.[e.id] || now < new Date(e.end) || !e.lan) continue;
    const inEvent = next.extra.filter(x => x.at && new Date(x.at) >= new Date(e.start) && new Date(x.at) <= new Date(e.end));
    const last = inEvent.sort((x, y) => new Date(y.at) - new Date(x.at))[0];
    if (last && last.sa !== last.sb) {
      winners[e.id] = { team: last.sa > last.sb ? last.a : last.b, src: "auto" };
      next.changed++;
      console.log(`  ${e.k} winner: ${winners[e.id].team}`);
    }
  }
  if (!next.changed) { console.log("  No new results."); return; }
  for (const [id, r] of Object.entries(next.matches)) if (!results.matches?.[id] || results.matches[id].sa !== r.sa || results.matches[id].sb !== r.sb) {
    const m = schedule.matches.find(x => x.id === id);
    console.log(`  ${id}: ${m.a} ${r.sa}–${r.sb} ${m.b}`);
  }
  write("results.json", { updated: now.toISOString(), source: "Cito API", matches: next.matches, extra: next.extra, winners });
  console.log(`  ${next.changed} change(s).`);
}

// ---------- Other leagues: rolling list from the source ----------
async function runGeneric(league) {
  const file = `leagues/${league.id}.json`;
  const store = read(file, emptyStore(league.id));
  const p = plan(league, store, { now, planName: config.plan, force });
  console.log(`\n${league.name}: ${store.matches.length} stored, ${p.due} awaiting a result`);
  if (!p.upcoming && !p.recent) { console.log("  Not due yet. No API call made."); return; }
  let changed = 0;
  for (const [kind, want, status] of [["recent", p.recent, "completed"], ["upcoming", p.upcoming, "upcoming"]]) {
    if (!want) continue;
    if (budgetLeft() < 1) { console.log("  Monthly call limit reached. Skipping."); break; }
    try {
      const body = await fetchFirst(league.api[kind]);
      const n = mergeInto(store, body, status, now);
      store[`${kind}Fetched`] = now.toISOString();
      console.log(`  ${kind}: ${listFrom(body).length} from source, ${n} added or changed`);
      changed += n;
    } catch (e) {
      if (e.fatal) throw e;
      failures++; console.error(`  ${kind}: ${e.message}`);
    }
  }
  if (changed) store.updated = now.toISOString();
  write(file, store); // also saves when we last checked, so the next run waits its turn
}

// ---------- run ----------
try {
  for (const league of config.leagues) {
    if (only && league.id !== only) continue;
    if (league.type === "cdl") await runCdl();
    else if (league.api) await runGeneric(league);
  }
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  failures++;
}

const used = callCount();
if (used && !opt("--fixture") && !process.env.FIXTURE_DIR) write("usage.json", { month, calls: usedBefore + used, limit: config.monthlyCallLimit, updated: now.toISOString() });
console.log(`\nAPI calls this run: ${used}. This month: ${usedBefore + used} of ${config.monthlyCallLimit}.`);

if (dry) { console.log(`Dry run: ${pending.size} file(s) not written.`); setOutput("changed", "false"); }
else {
  for (const [f, obj] of pending) {
    fs.mkdirSync(path.dirname(path.join(dataDir, f)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, f), JSON.stringify(obj, null, 1) + "\n");
  }
  if (pending.size) console.log(`Wrote ${[...pending.keys()].join(", ")}.`);
  setOutput("changed", pending.size ? "true" : "false");
}
process.exit(failures && !pending.size ? 1 : 0);
