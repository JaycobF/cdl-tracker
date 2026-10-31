import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { teamCode } from "../scripts/lib/teams.mjs";
import { listFrom, normalizeMatch, isFinal } from "../scripts/lib/normalize.mjs";
import { applyResults, dueMatches, activeEvent } from "../scripts/lib/apply.mjs";

const root = path.resolve(import.meta.dirname, "..");
const schedule = JSON.parse(fs.readFileSync(path.join(root, "public/data/schedule.json"), "utf8"));
const fixture = n => JSON.parse(fs.readFileSync(path.join(root, "test/fixtures", n), "utf8"));
const empty = { matches: {}, extra: [], winners: {} };

test("team names in common spellings map to schedule codes", () => {
  const cases = { "FaZe Vegas": "VGS", "Vegas FaZe": "VGS", "OpTic Texas": "TX", "Texas OpTic": "TX", "G2 Minnesota": "MIN",
    "Cloud9 New York": "C9NY", "New York Cloud9": "C9NY", "M80 Boston": "BOS", "Boston M80": "BOS", "Toronto KOI": "TOR",
    "Paris Gentle Mates": "PAR", "Riyadh Falcons": "RYD", "Los Angeles Thieves": "LAT", "LA Thieves": "LAT",
    "Miami Heretics": "MIA", "Carolina Royal Ravens": "CAR", "Vancouver Surge": "VAN", "Minnesota RØKKR": "MIN" };
  for (const [name, code] of Object.entries(cases)) assert.equal(teamCode(name), code, name);
  assert.equal(teamCode("Huntsmen"), null);
  assert.equal(teamCode("OMiT"), null);
});

test("reads the documented source shape", () => {
  const list = listFrom(fixture("cito-style.json")).map(normalizeMatch);
  assert.equal(list.length, 5);
  assert.deepEqual([list[0].a.code, list[0].a.score, list[0].b.code, list[0].b.score], ["VGS", 3, "PAR", 1]);
  assert.equal(isFinal(list[0]), true);
  assert.equal(isFinal(list[2]), false, "live series is not final");
});

test("reads an alternative shape (teams array, score string, epoch time)", () => {
  const list = listFrom(fixture("alt-style.json")).map(normalizeMatch);
  assert.deepEqual([list[0].a.code, list[0].a.score, list[0].b.code, list[0].b.score], ["TX", 2, "LAT", 3]);
  assert.equal(list[0].at.toISOString(), "2027-01-17T23:05:00.000Z");
  assert.equal(isFinal(list[0]), true);
  assert.deepEqual([list[1].a.score, list[1].b.score, list[1].status], [4, 2, "completed"]);
});

test("matches results to the schedule, swapping sides when the source lists teams the other way", () => {
  const now = new Date("2027-01-18T03:00:00Z");
  const normalized = [...listFrom(fixture("cito-style.json")), ...listFrom(fixture("alt-style.json"))].map(normalizeMatch);
  const r = applyResults(schedule, empty, normalized, now);
  assert.deepEqual(pickScore(r.matches["m1-01"]), { sa: 3, sb: 1 }, "VGS 3-1 PAR");
  assert.deepEqual(pickScore(r.matches["m1-02"]), { sa: 2, sb: 3 }, "C9NY listed first in schedule, MIA won 3-2");
  assert.deepEqual(pickScore(r.matches["m1-10"]), { sa: 3, sb: 2 }, "LAT listed first in schedule, won 3-2");
  assert.equal(r.matches["m1-03"], undefined, "live series not recorded");
  assert.ok(!r.extra.some(x => x.at?.startsWith("2026-08")), "last season's results ignored");
  assert.ok(!r.extra.some(x => x.b === null), "matches against non-CDL teams ignored");
});

test("a second run with the same data changes nothing", () => {
  const now = new Date("2027-01-18T03:00:00Z");
  const normalized = listFrom(fixture("cito-style.json")).map(normalizeMatch);
  const first = applyResults(schedule, empty, normalized, now);
  const second = applyResults(schedule, first, normalized, now);
  assert.equal(second.changed, 0);
});

test("skips the API when nothing is due", () => {
  assert.equal(dueMatches(schedule, empty, {}, new Date("2026-11-01T00:00:00Z")).length, 0);
  assert.equal(activeEvent(schedule, new Date("2026-11-01T00:00:00Z")), null);
  assert.equal(dueMatches(schedule, empty, {}, new Date("2027-01-16T03:00:00Z")).length, 3);
  const withOverride = { matches: { "m1-01": { sa: 3, sb: 0 } } };
  assert.equal(dueMatches(schedule, empty, withOverride, new Date("2027-01-16T03:00:00Z")).length, 2);
});

test("full run writes results.json and picks the Major winner from its last series", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdl-"));
  for (const f of ["schedule.json", "overrides.json"]) fs.copyFileSync(path.join(root, "public/data", f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(empty));
  const run = (fx, now) => execFileSync("node", [path.join(root, "scripts/update-scores.mjs"), "--fixture", path.join(root, "test/fixtures", fx), "--now", now], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" });
  run("cito-style.json", "2027-01-18T03:00:00Z");
  const out = run("alt-style.json", "2027-02-16T03:00:00Z");
  const res = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
  assert.equal(res.matches["m1-01"].sa, 3);
  assert.equal(res.matches["m1-10"].sa, 3);
  assert.equal(res.extra.length, 1);
  assert.equal(res.winners.m1?.team, "TOR", out);
});

const pickScore = r => r && { sa: r.sa, sb: r.sb };
