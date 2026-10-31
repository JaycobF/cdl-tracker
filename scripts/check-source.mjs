#!/usr/bin/env node
// Checks that the data source works and that its matches are read correctly.
// Usage:
//   CITO_API_KEY=... node scripts/check-source.mjs                 CDL
//   CITO_API_KEY=... node scripts/check-source.mjs --league cs2    another league (recent + upcoming)
//   node scripts/check-source.mjs --fixture file.json              read a saved response instead
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFrom, normalizeMatch, isFinal } from "./lib/normalize.mjs";
import { fetchFirst, fetchRecentMatches } from "./lib/source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const config = JSON.parse(fs.readFileSync(path.join(root, "public/data/leagues.json"), "utf8"));
const league = config.leagues.find(l => l.id === (arg("--league") || "cdl"));
if (!league) { console.error(`Unknown league. Choose one of: ${config.leagues.map(l => l.id).join(", ")}`); process.exit(1); }

function show(label, payload) {
  const list = listFrom(payload);
  console.log(`\n${label}: ${list.length} matches`);
  if (!list.length) { console.log("  Response shape:", JSON.stringify(payload).slice(0, 600)); return false; }
  console.log("  Fields on the first match:", Object.keys(list[0]).join(", "));
  const unknown = new Set();
  for (const raw of list.slice(0, 8)) {
    const n = normalizeMatch(raw);
    const t = s => s ? `${s.name || "?"}${league.type === "cdl" ? ` [${s.code || "not recognised"}]` : s.short ? ` (${s.short})` : ""} ${s.score ?? "-"}` : "missing";
    console.log(`  ${n.at ? n.at.toISOString().slice(0, 16) : "no time"}  ${t(n.a)}  vs  ${t(n.b)}  status=${n.status}${isFinal(n) ? " FINAL" : ""}  ${n.event}`);
  }
  if (league.type === "cdl") {
    for (const raw of list) { const n = normalizeMatch(raw); for (const s of [n.a, n.b]) if (s && !s.code && s.name) unknown.add(s.name); }
    if (unknown.size) console.log(`  Team names not recognised (fine if they're Challengers teams): ${[...unknown].join(", ")}`);
  }
  return true;
}

console.log(`Checking ${league.name}`);
try {
  if (arg("--fixture")) show("Saved response", JSON.parse(fs.readFileSync(arg("--fixture"), "utf8")));
  else if (league.type === "cdl") show("Recent", await fetchRecentMatches());
  else {
    show("Recent", await fetchFirst(league.api.recent).catch(e => ({ error: e.message })));
    show("Upcoming", await fetchFirst(league.api.upcoming).catch(e => ({ error: e.message })));
  }
} catch (e) { console.error(e.message); process.exit(1); }
console.log("\nIf times, scores or teams look wrong above, share this output so the reader can be adjusted.");
