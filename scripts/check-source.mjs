#!/usr/bin/env node
// One-off check that the data source works and that its matches are read correctly.
// Usage: CITO_API_KEY=... node scripts/check-source.mjs   (or --fixture file.json)
import fs from "node:fs";
import { listFrom, normalizeMatch, isFinal } from "./lib/normalize.mjs";
import { fetchRecentMatches } from "./lib/source.mjs";

const i = process.argv.indexOf("--fixture");
const payload = i > 0
  ? JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8"))
  : await fetchRecentMatches({ apiKey: process.env.CITO_API_KEY }).catch(e => { console.error(e.message); process.exit(1); });

const list = listFrom(payload);
console.log(`\nMatches in response: ${list.length}`);
if (!list.length) { console.log("Response shape:", JSON.stringify(payload).slice(0, 600)); process.exit(1); }
console.log("Fields on the first match:", Object.keys(list[0]).join(", "));

const unknown = new Set();
console.log("\nHow the first 8 matches are read:");
for (const raw of list.slice(0, 8)) {
  const n = normalizeMatch(raw);
  const t = s => s ? `${s.name || "?"} [${s.code || "not recognised"}] ${s.score ?? "-"}` : "missing";
  console.log(`  ${n.at ? n.at.toISOString().slice(0, 16) : "no time"}  ${t(n.a)}  vs  ${t(n.b)}  status=${n.status}${isFinal(n) ? " FINAL" : ""}  ${n.event}`);
}
for (const raw of list) { const n = normalizeMatch(raw); for (const s of [n.a, n.b]) if (s && !s.code && s.name) unknown.add(s.name); }
if (unknown.size) console.log(`\nTeam names not recognised (fine if they're Challengers teams): ${[...unknown].join(", ")}`);
console.log("\nIf times, scores or teams look wrong above, share this output and the field list so the reader can be adjusted.");
