import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { emptyStore, plan, mergeInto } from "../scripts/lib/generic.mjs";

const root = path.resolve(import.meta.dirname, "..");
const api = path.join(root, "test/fixtures/api");
const fx = n => JSON.parse(fs.readFileSync(path.join(api, n), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(root, "public/data/leagues.json"), "utf8"));
const league = id => config.leagues.find(l => l.id === id);
const NOW = new Date("2027-01-17T20:00:00Z");

test("every league in the config has the fields the updater and app need", () => {
  for (const l of config.leagues) {
    assert.ok(l.id && l.name && l.short && l.type, l.id);
    if (l.type !== "cdl") {
      assert.ok(l.api.upcoming.length && l.api.recent.length, `${l.id} paths`);
      assert.ok(l.checkEveryMinutes.free && l.checkEveryMinutes.starter, `${l.id} cadence`);
    }
  }
});

test("reads LoL results, including scores nested in each team", () => {
  const s = emptyStore("lol");
  mergeInto(s, fx("lol__schedule__upcoming.json"), "upcoming", new Date("2027-01-16T00:00:00Z"));
  assert.equal(s.matches.length, 3);
  assert.equal(s.matches[0].event, "LCK");
  assert.equal(s.matches[0].bestOf, 3);
  assert.equal(s.matches[0].a.short, "T1");
  assert.equal(s.matches[0].status, "upcoming");
  mergeInto(s, fx("lol__schedule__results.json"), "completed", NOW);
  const t1 = s.matches.find(m => m.id === "lol-1");
  assert.equal(t1.status, "completed");
  assert.deepEqual([t1.a.name, t1.sa, t1.b.name, t1.sb], ["T1", 1, "Gen.G", 2], "keeps original team order when the source flips it");
  assert.equal(s.matches.filter(m => m.id === "lol-1").length, 1, "no duplicate");
  assert.ok(s.matches.some(m => m.id === "lol-9" && m.sa === 2 && m.sb === 1));
});

test("CS2: finished, live and upcoming are told apart", () => {
  const s = emptyStore("cs2");
  mergeInto(s, fx("cs2__matches__recent.json"), "completed", NOW);
  mergeInto(s, fx("cs2__matches__upcoming.json"), "upcoming", NOW);
  const byId = Object.fromEntries(s.matches.map(m => [m.id, m]));
  assert.equal(byId["4990"].status, "completed");
  assert.equal(byId["4991"].status, "live");
  assert.equal(byId["5001"].status, "upcoming");
  assert.equal(byId["5001"].sa, null);
  assert.equal(byId["4990"].event, "BLAST Bounty");
  assert.equal(byId["4990"].a.short, "FAZE");
});

test("a match found again with a different id is merged, not duplicated", () => {
  const s = emptyStore("cs2");
  mergeInto(s, { data: [{ id: "x1", date: "2027-01-17T15:00:00Z", team1: { name: "NAVI" }, team2: { name: "Vitality" }, status: "upcoming" }] }, "upcoming", NOW);
  mergeInto(s, { data: [{ id: "y9", date: "2027-01-17T15:20:00Z", team1: { name: "Vitality", score: 2 }, team2: { name: "NAVI", score: 1 }, status: "finished" }] }, "completed", NOW);
  assert.equal(s.matches.length, 1);
  assert.deepEqual([s.matches[0].a.name, s.matches[0].sa, s.matches[0].sb, s.matches[0].status], ["NAVI", 1, 2, "completed"]);
});

test("a result is never replaced by an older 'upcoming' copy", () => {
  const s = emptyStore("cs2");
  mergeInto(s, fx("cs2__matches__recent.json"), "completed", NOW);
  mergeInto(s, { data: [{ id: 4990, date: "2027-01-16T19:00:00Z", team1: { name: "FaZe Clan" }, team2: { name: "MOUZ" }, status: "upcoming" }] }, "upcoming", NOW);
  assert.equal(s.matches.find(m => m.id === "4990").status, "completed");
});

test("old and abandoned matches are pruned", () => {
  const s = emptyStore("dota2");
  mergeInto(s, { data: [
    { id: "old", begin_at: "2026-11-01T00:00:00Z", teams: [{ name: "A" }, { name: "B" }], scores: [2, 0], status: "finished" },
    { id: "stuck", begin_at: "2027-01-10T00:00:00Z", teams: [{ name: "C" }, { name: "D" }], status: "upcoming" },
    { id: "ok", begin_at: "2027-01-17T00:00:00Z", teams: [{ name: "E" }, { name: "F" }], scores: [2, 1], status: "finished" }
  ] }, "completed", NOW);
  assert.deepEqual(s.matches.map(m => m.id), ["ok"]);
});

test("checks follow the plan's cadence and only when a match is waiting", () => {
  const L = league("cs2");
  const s = emptyStore("cs2");
  assert.deepEqual(plan(L, s, { now: NOW }), { upcoming: true, recent: true, due: 0 }, "first run fetches both");
  s.upcomingFetched = s.recentFetched = new Date(NOW - 60 * 60e3).toISOString();
  s.matches = [{ id: "1", at: new Date(NOW - 2 * 3600e3).toISOString(), status: "upcoming", a: { name: "A" }, b: { name: "B" } }];
  assert.equal(plan(L, s, { now: NOW, planName: "free" }).recent, false, "free plan waits 8 hours between checks");
  assert.equal(plan(L, s, { now: NOW, planName: "starter" }).recent, true, "starter plan checks after 30 minutes");
  s.matches = [];
  assert.equal(plan(L, s, { now: NOW, planName: "starter" }).recent, false, "nothing waiting, no check");
  assert.equal(plan(L, s, { now: NOW, planName: "starter", force: true }).recent, true);
});

function runAll(extraArgs = [], env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "esp-"));
  for (const f of ["schedule.json", "overrides.json", "leagues.json", "results.json"]) fs.copyFileSync(path.join(root, "public/data", f), path.join(dir, f));
  const out = execFileSync("node", [path.join(root, "scripts/update-scores.mjs"), "--now", "2027-01-17T20:00:00Z", ...extraArgs],
    { env: { ...process.env, DATA_DIR: dir, FIXTURE_DIR: api, ...env }, encoding: "utf8" });
  return { dir, out, read: f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) };
}

test("one run updates CDL and every other league", () => {
  const { dir, out, read } = runAll(["--force"]);
  assert.equal(read("results.json").matches["m1-01"].sa, 3, out);
  const lol = read("leagues/lol.json"), cs2 = read("leagues/cs2.json"), dota = read("leagues/dota2.json");
  assert.ok(lol.matches.length >= 4 && lol.recentFetched && lol.upcomingFetched);
  assert.ok(cs2.matches.some(m => m.status === "completed"));
  assert.equal(dota.matches.length, 1, "Dota still gets upcoming matches when results aren't available");
  assert.match(out, /dota2\/matches\/recent: HTTP 404/);
  assert.ok(!fs.existsSync(path.join(dir, "usage.json")), "saved responses don't count against the monthly limit");
});

test("--league runs just one league", () => {
  const { dir, read } = runAll(["--force", "--league", "cs2"]);
  assert.ok(read("leagues/cs2.json").matches.length);
  assert.ok(!fs.existsSync(path.join(dir, "leagues/lol.json")));
});

test("stops calling the source once the monthly limit is reached", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "esp-"));
  for (const f of ["schedule.json", "overrides.json", "results.json"]) fs.copyFileSync(path.join(root, "public/data", f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, "leagues.json"), JSON.stringify({ ...config, monthlyCallLimit: 3 }));
  fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ month: "2027-01", calls: 1 }));
  const out = execFileSync("node", [path.join(root, "scripts/update-scores.mjs"), "--now", "2027-01-17T20:00:00Z", "--force"],
    { env: { ...process.env, DATA_DIR: dir, FIXTURE_DIR: api }, encoding: "utf8" });
  assert.match(out, /API calls this run: 2\./, out);
  assert.match(out, /Monthly call limit reached/);
});

test("status words: 'unstarted' and 'not_started' are upcoming, not live", async () => {
  const { normalizeMatch } = await import("../scripts/lib/normalize.mjs");
  const st = s => normalizeMatch({ status: s, teams: [{ name: "A" }, { name: "B" }] }).status;
  assert.equal(st("unstarted"), "upcoming");
  assert.equal(st("not_started"), "upcoming");
  assert.equal(st("notStarted"), "upcoming");
  assert.equal(st("inProgress"), "live");
  assert.equal(st("running"), "live");
  assert.equal(st("finished"), "completed");
});

test("API key: a pasted example command still yields the key, and keys never reach logs or files", async () => {
  const { cleanKey, redact } = await import("../scripts/lib/source.mjs");
  const k = "cito_" + "a1b2c3d4e5f6".repeat(4);
  assert.equal(cleanKey(k), k);
  assert.equal(cleanKey(`  ${k}\n`), k);
  assert.equal(cleanKey(`curl "https://api.citoapi.com/api/v1/cod/matches?limit=5" \\\n  -H "x-api-key: ${k}"`), k);
  assert.equal(cleanKey(`x-api-key: other-key-123456`), "other-key-123456");
  assert.equal(cleanKey("two words"), "");
  const msg = redact(`Headers.append: "curl ... -H \\"x-api-key: ${k}\\"" is invalid`, `curl -H "x-api-key: ${k}"`);
  assert.ok(!msg.includes(k), msg);
  assert.ok(!redact(`x-api-key: secretvalue99`).includes("secretvalue99"));
});

test("real response shapes: CS2, Dota 2 and LoL upcoming", async () => {
  const s = (f, kind) => { const st = emptyStore("x"); mergeInto(st, JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/real", f), "utf8")), kind, new Date("2026-10-31T20:00:00Z")); return st.matches; };
  const [cs] = s("cs2-recent.json", "completed");
  assert.deepEqual([cs.a.name, cs.a.short, cs.sa, cs.sb, cs.b.name, cs.status, cs.event, cs.bestOf], ["Team Spirit", "SPIRIT", 2, 1, "The MongolZ", "completed", "IEM Chengdu 2026", 3]);
  const [up] = s("cs2-upcoming.json", "upcoming");
  assert.deepEqual([up.status, up.sa, up.at], ["upcoming", null, "2026-11-01T09:00:00.000Z"]);
  const [d] = s("dota-recent.json", "completed");
  assert.deepEqual([d.a.name, d.sa, d.sb, d.b.name, d.status], ["Team Falcons", 2, 0, "Tundra Esports", "completed"], "names beside empty team objects");
  const [l] = s("lol-upcoming.json", "upcoming");
  assert.deepEqual([l.a.short, l.bestOf, l.status], ["FL", 5, "upcoming"]);
});

test("team logos from the source are kept, only as https links", () => {
  const st = emptyStore("cs2");
  mergeInto(st, JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/real/cs2-recent.json"), "utf8")), "completed", new Date("2026-10-31T20:00:00Z"));
  assert.equal(st.matches[0].a.logo, "https://img.example.com/spirit.png");
  assert.equal(st.matches[0].b.logo, undefined);
  const bad = emptyStore("x");
  mergeInto(bad, { data: [{ id: 1, startsAt: "2026-10-31T10:00:00Z", status: "finished", team1: { name: "A", logoUrl: "javascript:alert(1)", score: 2 }, team2: { name: "B", score: 0 } }] }, "completed", new Date("2026-10-31T20:00:00Z"));
  assert.equal(bad.matches[0].a.logo, undefined);
});
