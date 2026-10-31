"use strict";
/* Esports Tracker — reads data/*.json, which the scheduled updater keeps current. */

let S, H;                       // schedule.json, history.json
let auto = { matches: {}, extra: [], winners: {} }, ov = { matches: {}, winners: {} };
let results = {}, winners = {}; // merged view
let TEAMS = {}, CODES = [], MATCHES = [];

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = d => d.toLocaleDateString("en-CA");
const fmtDay = d => d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ""; } })();
const crest = c => TEAMS[c] ? `<span class="crest" style="background:${TEAMS[c].color}" aria-hidden="true">${c}</span>` : `<span class="crest gen" aria-hidden="true">?</span>`;
const initials = n => n.split(" ").filter(w => /^[A-Z0-9]/.test(w)).map(w => w[0]).join("").slice(0, 3);
const genCrest = n => `<span class="crest gen" aria-hidden="true">${esc(initials(n))}</span>`;
const short = c => TEAMS[c]?.short || c;
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

async function getJSON(name, bust) {
  const r = await fetch(`data/${name}${bust ? `?t=${Date.now()}` : ""}`, { cache: bust ? "no-store" : "default" });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

function merge() {
  results = { ...auto.matches };
  for (const [id, v] of Object.entries(ov.matches || {})) if (v && typeof v.sa === "number") results[id] = { ...v, src: "manual" };
  winners = {};
  for (const [id, v] of Object.entries(auto.winners || {})) winners[id] = v.team;
  for (const [id, v] of Object.entries(ov.winners || {})) if (TEAMS[v]) winners[id] = v;
}

/* ---------- standings ---------- */
function computeStandings() {
  const t = {};
  for (const c of CODES) t[c] = { c, w: 0, l: 0, mw: 0, ml: 0, p: 0, form: [] };
  for (const m of MATCHES) {
    const r = results[m.id]; if (!r || !t[m.a] || !t[m.b]) continue;
    const A = t[m.a], B = t[m.b];
    A.mw += r.sa; A.ml += r.sb; B.mw += r.sb; B.ml += r.sa;
    if (r.sa > r.sb) { A.w++; B.l++; A.p += 10; A.form.push("W"); B.form.push("L"); }
    else { B.w++; A.l++; B.p += 10; B.form.push("W"); A.form.push("L"); }
  }
  return Object.values(t).sort((x, y) => y.p - x.p || (y.mw - y.ml) - (x.mw - x.ml) || y.mw - x.mw || TEAMS[x.c].name.localeCompare(TEAMS[y.c].name));
}
const formHTML = f => { const l = f.slice(-5); return `<span class="form">${'<span class="fm N"></span>'.repeat(5 - l.length)}${l.map(x => `<span class="fm ${x}">${x}</span>`).join("")}</span>`; };
const diff = r => { const d = r.mw - r.ml; return `${d > 0 ? "+" : ""}${d}`; };

function renderStandings() {
  const rows = computeStandings();
  const played = MATCHES.filter(m => results[m.id]).length;
  $("#st-note").textContent = played ? `${played} of ${MATCHES.length} series played` : "Season starts Dec 4";
  $("#standings").innerHTML = `<thead><tr><th>#</th><th class="l">Team</th><th>PL</th><th>W</th><th>L</th><th class="hs">Maps</th><th>+/-</th><th>PTS</th><th class="hs l">Form</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="pos ${i < 8 ? "z" : ""}">${i + 1}</td><td class="l"><span class="tn">${crest(r.c)}<span class="nm">${esc(TEAMS[r.c].name)}</span></span></td><td>${r.w + r.l}</td><td>${r.w}</td><td>${r.l}</td><td class="hs">${r.mw}–${r.ml}</td><td>${diff(r)}</td><td class="pts">${r.p}</td><td class="hs l">${formHTML(r.form)}</td></tr>`).join("") + "</tbody>";
  $("#mini").innerHTML = `<thead><tr><th>#</th><th class="l">Team</th><th>PL</th><th>+/-</th><th>PTS</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="pos ${i < 8 ? "z" : ""}">${i + 1}</td><td class="l"><span class="tn">${crest(r.c)}<span class="nm">${esc(short(r.c))}</span></span></td><td>${r.w + r.l}</td><td>${diff(r)}</td><td class="pts">${r.p}</td></tr>`).join("") + "</tbody>";
}

/* ---------- top, next event, road ---------- */
const nextEventIdx = () => { const now = Date.now(); return S.events.findIndex(e => new Date(e.end).getTime() > now); };
function renderTop() {
  const now = Date.now(), E = S.events;
  const kick = new Date(E[0].start).getTime(), champs = new Date(E[E.length - 1].start).getTime();
  if (now < kick) { $("#cd").textContent = Math.ceil((kick - now) / 864e5); $("#cdl").textContent = "days to kickoff"; }
  else if (now < champs) { $("#cd").textContent = Math.ceil((champs - now) / 864e5); $("#cdl").textContent = "days to Champs"; }
  else { const w = winners.champs; $("#cd").textContent = w ? short(w) : "Champs"; $("#cdl").textContent = w ? "2027 champions" : "underway"; }
  const i = nextEventIdx();
  if (i < 0) { $("#nextEvent").innerHTML = ""; return; }
  const e = E[i], s = new Date(e.start), live = now >= s.getTime();
  $("#nextEvent").innerHTML = `<div class="ne"><div class="big">${live ? `<span>Live</span>` : `<b>${s.toLocaleDateString([], { day: "numeric" })}</b><span>${s.toLocaleDateString([], { month: "short" })}</span>`}</div><div><h3>${esc(e.k)}${e.lan ? '<span class="lan">LAN</span>' : ""}</h3><div class="sub">${esc(e.d)} · ${esc(e.w)}</div></div></div>`;
}
function renderRoad() {
  const ni = nextEventIdx();
  $("#road").innerHTML = S.events.map((e, i) => {
    const w = winners[e.id];
    const cls = ["ev", (i < ni || ni < 0) ? "done" : "", i === ni ? "next" : ""].join(" ");
    return `<div class="${cls}" style="cursor:default"><span class="dot"></span><span><span class="k">${esc(e.k)}</span>${e.lan ? '<span class="lan">LAN</span>' : ""}<br><span class="w">${esc(e.d)} · ${esc(e.w)}</span></span><span class="r">${w ? `${crest(w)}${esc(short(w))}` : `<span class="sub">TBD</span>`}</span></div>`;
  }).join("");
}

/* ---------- matches ---------- */
function rowHTML(a, b, r, at, tag) {
  const aw = r && r.sa > r.sb, bw = r && r.sb > r.sa;
  const nm = c => `<span class="nm"><span class="long">${esc(TEAMS[c]?.name || c)}</span><span class="short">${esc(short(c))}</span></span>`;
  return `<div class="m"><div class="mr">
    <span class="side a${bw ? " lost" : ""}">${nm(a)}${crest(a)}</span>
    <span class="mid">${r ? `<span class="sc">${r.sa} - ${r.sb}</span><span class="ftag">${tag || "FT"}</span>` : `<span class="tm">${at ? fmtTime(at) : "TBD"}</span>`}</span>
    <span class="side${aw ? " lost" : ""}">${crest(b)}${nm(b)}</span>
  </div></div>`;
}
const matchHTML = m => rowHTML(m.a, m.b, results[m.id], m.at, results[m.id]?.src === "manual" ? "FT · edited" : "FT");
function dayGroups(list, label) {
  let h = "", last = "";
  for (const m of list) {
    const k = dayKey(m.at);
    if (k !== last) { h += `<div class="dh">${fmtDay(m.at)}<span>${esc(label(m))}</span></div>`; last = k; }
    h += matchHTML(m);
  }
  return h;
}
const stageLabel = m => (S.stages[m.stage] || "").replace(" qualifiers", "");

function extraList() {
  return (auto.extra || []).filter(x => x.at && TEAMS[x.a] && TEAMS[x.b]).map(x => ({ ...x, at: new Date(x.at) })).sort((a, b) => a.at - b.at);
}
function eventFor(d) { return S.events.find(e => d >= new Date(e.start).getTime() - 864e5 && d <= new Date(e.end).getTime() + 864e5); }

function renderNext() {
  const now = Date.now();
  const up = MATCHES.filter(m => !results[m.id] && m.at.getTime() > now - 3 * 3600e3).slice(0, 4);
  let h = "";
  if (now < new Date(S.events[1].end).getTime()) h += `<div class="tba"><b>Kickoff Tournament and Pro-Am Minor</b> come first. Matchups appear once the brackets are drawn. First listed series:</div>`;
  h += up.length ? dayGroups(up, stageLabel) : `<p class="note">All listed series have results.</p>`;
  $("#next").innerHTML = h;
  const done = [
    ...MATCHES.filter(m => results[m.id]).map(m => ({ at: m.at, html: matchHTML(m) })),
    ...extraList().map(x => ({ at: x.at, html: rowHTML(x.a, x.b, x, x.at) }))
  ].sort((a, b) => b.at - a.at).slice(0, 4);
  $("#latestCard").hidden = !done.length;
  $("#latest").innerHTML = done.map(d => d.html).join("");
}

let evFilter = "all";
function renderSchedule() {
  const team = $("#teamf").value, state = $("#statef").value;
  const evs = [["all", "All"], ["m1", "Major I"], ["m2", "Major II"], ["m3", "Major III"], ["m4", "Major IV"], ["lan", "LAN events"]];
  $("#evf").innerHTML = evs.map(([k, l]) => `<button class="pill ${evFilter === k ? "on" : ""}" data-evf="${k}">${l}</button>`).join("");
  let list = MATCHES.filter(m => (!team || m.a === team || m.b === team));
  if (state === "up") list = list.filter(m => !results[m.id]);
  if (state === "res") list = list.filter(m => results[m.id]);
  const tba = (t, b) => `<div class="card"><div class="ch"><h2>${t}</h2></div><div class="tba">${b}</div></div>`;
  let h = "";
  if (evFilter === "all" && state !== "res" && !team) h += tba("Before Major I", "<b>Kickoff Tournament</b> (Dec 4–13) and <b>Pro-Am Minor</b> (Jan 8–10). Teams aren't drawn yet.");
  for (const st of ["m1", "m2", "m3", "m4"]) {
    if (evFilter !== "all" && evFilter !== st) continue;
    const sub = list.filter(m => m.stage === st);
    if (!sub.length) {
      if (st === "m2" && state !== "res" && (!team || evFilter === "m2") && !MATCHES.some(m => m.stage === "m2"))
        h += tba("Major II qualifiers", "Qualifiers start Feb 26, with the LAN at <b>DreamHack Birmingham, Apr 2–4</b>. The league hasn't published these matchups yet.");
      continue;
    }
    const done = sub.filter(m => results[m.id]).length;
    h += `<div class="card"><div class="ch"><h2>${esc(S.stages[st] || st)}</h2><span class="sub">${done}/${sub.length} played</span></div>${dayGroups(sub, stageLabel)}</div>`;
  }
  if ((evFilter === "all" || evFilter === "lan") && state !== "up") {
    const ex = extraList().filter(x => !team || x.a === team || x.b === team);
    if (ex.length) {
      let g = "", last = "";
      for (const x of ex) {
        const k = dayKey(x.at);
        if (k !== last) { g += `<div class="dh">${fmtDay(x.at)}<span>${esc(x.event || eventFor(x.at.getTime())?.k || "")}</span></div>`; last = k; }
        g += rowHTML(x.a, x.b, x, x.at);
      }
      h += `<div class="card"><div class="ch"><h2>LAN events &amp; other results</h2><span class="sub">${ex.length} series</span></div>${g}</div>`;
    } else if (evFilter === "lan") h += tba("LAN events", "Major brackets, Champs and Kickoff results appear here automatically as they're played.");
  }
  if (!h) h = `<div class="card"><p class="note" style="padding-top:14px">No matches fit these filters.</p></div>`;
  $("#sched").innerHTML = h;
}

/* ---------- history ---------- */
let histYear = 2026;
function renderHistory() {
  $("#seasons").innerHTML = H.seasons.map(s => `<button class="pill ${s.y === histYear ? "on" : ""}" data-y="${s.y}">${s.y}</button>`).join("");
  const s = H.seasons.find(x => x.y === histYear);
  const evRows = s.events.map(e => `<div class="er"><span class="k">${esc(e[0])}</span><span class="w">${esc(e[1])}</span><span class="s">${e[3] ? `<span class="sc">${esc(e[3].replace("–", " - "))}</span>` : `<span class="sub">vs</span>`}</span><span class="l2">${esc(e[2] || "Runner-up n/a")}</span>${(e[4] || e[5]) ? `<span class="x">${esc([e[4], e[5] ? "MVP " + e[5] : ""].filter(Boolean).join(" · "))}</span>` : ""}</div>`).join("");
  const stRows = s.st.map((r, i) => { const d = r[4] - r[5]; return `<tr><td class="pos ${(i < 8 || s.y === 2020) ? "z" : ""}">${i + 1}</td><td class="l"><span class="tn">${genCrest(r[0])}<span class="nm">${esc(r[0])}</span>${r[0] === s.champ ? ` <span style="color:var(--gold)" title="Champion">★</span>` : ""}</span></td><td>${r[2] + r[3]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="hs">${r[4]}–${r[5]}</td><td>${d > 0 ? "+" : ""}${d}</td><td class="pts">${r[1]}</td></tr>`; }).join("");
  $("#hist").innerHTML = `
    <div class="card">
      <div class="ch"><h2>${s.y} · ${esc(s.game)}</h2><span class="sub">${esc(s.dates)}</span></div>
      <div class="hero"><div class="yr">${s.y}</div><div><div class="sub" style="color:var(--gold);font-weight:700">WORLD CHAMPIONS</div><h3>${esc(s.champ)}</h3><p>Beat ${esc(s.runner)} ${esc(s.score)} · ${esc(s.where)}</p></div></div>
      <div class="facts"><div><div class="k">Roster</div><div class="v">${esc(s.roster)}</div></div><div><div class="k">Finals MVP</div><div class="v">${esc(s.fmvp)}</div></div><div><div class="k">Season MVP</div><div class="v">${esc(s.smvp)}</div></div></div>
    </div>
    <div class="cols">
      <div class="card"><div class="ch"><h2>${esc(s.evLabel)}</h2><span class="sub">Winner · final · runner-up</span></div>${evRows}${s.y === 2020 ? `<p class="note" style="padding-top:10px">Runner-ups shown where reported.</p>` : ""}</div>
      <div class="card"><div class="ch"><h2>Final table</h2><span class="sub">Regular season</span></div>
        <div class="tw"><table><thead><tr><th>#</th><th class="l">Team</th><th>PL</th><th>W</th><th>L</th><th class="hs">Maps</th><th>+/-</th><th>PTS</th></tr></thead><tbody>${stRows}</tbody></table></div>
        <div class="legend"><span><i></i>${s.y === 2020 ? "All 12 teams made the 2020 playoffs" : "Qualified for Champs"}</span></div>
      </div>
    </div>`;
}
function renderTitles() {
  $("#tl").innerHTML = H.seasons.map(s => `<div class="tl"><span class="y">${s.y}</span><span><b>${esc(s.champ)}</b><br><span class="g">${esc(s.game)} · ${esc(s.score)} vs ${esc(s.runner)}</span></span><span class="sub">MVP ${esc(s.fmvp)}</span></div>`).join("");
  const tally = {};
  const add = (team, key) => { const f = H.lineage[team] || team; tally[f] = tally[f] || { c: 0, m: 0 }; tally[f][key]++; };
  for (const s of H.seasons) { add(s.champ, "c"); if (s.y !== 2020) for (const e of s.events) if (!/Pro-Am|Kickoff/.test(e[0])) add(e[1], "m"); }
  const rows = Object.entries(tally).sort((a, b) => b[1].c - a[1].c || b[1].m - a[1].m || a[0].localeCompare(b[0]));
  $("#tally").innerHTML = `<thead><tr><th class="l">Franchise</th><th>Champs</th><th>Majors</th><th class="l hs"></th></tr></thead><tbody>` +
    rows.map(([n, v]) => `<tr><td class="l"><span class="tn">${genCrest(n)}<span class="nm">${esc(n)}</span></span></td><td class="pts">${v.c}</td><td>${v.m}</td><td class="l hs"><span class="bars">${"<i></i>".repeat(v.c)}${'<i class="m"></i>'.repeat(v.m)}</span></td></tr>`).join("") + "</tbody>";
}

/* ---------- other leagues (LoL, CS2, Dota 2) ---------- */
const PALETTE = ["#2F6FD6", "#D2462F", "#2E9E6B", "#8A4FD8", "#C9861A", "#1F9AAE", "#C2337B", "#5A6B86", "#7D9A23", "#B5532A"];
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const gAbbr = t => (t.short || initials(t.name) || t.name.slice(0, 3)).slice(0, 4).toUpperCase();
const gCrest = t => `<span class="crest" style="background:${hue(t.name)}" aria-hidden="true">${esc(gAbbr(t))}</span>`;
const gStore = {}; // league id -> store

function gRow(m) {
  const done = m.status === "completed", live = m.status === "live";
  const has = (done || live) && m.sa != null && m.sb != null;
  const aw = done && m.sa > m.sb, bw = done && m.sb > m.sa;
  const nm = t => `<span class="nm"><span class="long">${esc(t.name)}</span><span class="short">${esc(t.name.length <= 13 || !t.short ? t.name : t.short)}</span></span>`;
  const at = m.at ? new Date(m.at) : null;
  const mid = has ? `<span class="sc">${m.sa} - ${m.sb}</span><span class="ftag${live ? " live" : ""}">${live ? "LIVE" : "FT"}</span>`
    : live ? `<span class="tm" style="color:var(--loss)">LIVE</span>` : `<span class="tm">${at ? fmtTime(at) : "TBD"}</span>${m.bestOf ? `<span class="ftag">BO${m.bestOf}</span>` : ""}`;
  return `<div class="m"><div class="mr"><span class="side a${bw ? " lost" : ""}">${nm(m.a)}${gCrest(m.a)}</span><span class="mid">${mid}</span><span class="side${aw ? " lost" : ""}">${gCrest(m.b)}${nm(m.b)}</span></div></div>`;
}
function gGroups(list, showEvent = true) {
  let h = "", last = "";
  for (const m of list) {
    const d = new Date(m.at), k = dayKey(d) + (showEvent ? "|" + m.event : "");
    if (k !== last) { h += `<div class="dh">${fmtDay(d)}<span>${esc(showEvent ? m.event : "")}</span></div>`; last = k; }
    h += gRow(m);
  }
  return h;
}
function gEvents(list) {
  const c = {};
  for (const m of list) if (m.event) c[m.event] = (c[m.event] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([e]) => e);
}
function fillEventSelect(sel, list, key) {
  const evs = gEvents(list), saved = store.get(key) || "";
  sel.innerHTML = `<option value="">All events</option>` + evs.map(e => `<option>${esc(e)}</option>`).join("");
  sel.value = evs.includes(saved) ? saved : "";
}
function renderGeneric() {
  const L = current, st = gStore[L.id];
  const all = (st?.matches || []).filter(m => m.at);
  const now = Date.now();
  const live = all.filter(m => m.status === "live");
  const upcoming = all.filter(m => m.status !== "completed" && m.status !== "live" && new Date(m.at).getTime() > now - 3 * 3600e3);
  const done = all.filter(m => m.status === "completed").sort((a, b) => new Date(b.at) - new Date(a.at));

  const today = upcoming.filter(m => dayKey(new Date(m.at)) === dayKey(new Date())).length;
  $(".league .ct").hidden = !(live.length || today);
  $("#cd").textContent = live.length || today;
  $("#cdl").textContent = live.length ? "live now" : "matches today";
  const evs = gEvents(all.filter(m => Math.abs(new Date(m.at) - now) < 7 * 864e5)).slice(0, 3);
  $("#seasonline").textContent = evs.length ? evs.join(" · ") : "All events";

  const u = st?.updated ? new Date(st.updated) : null;
  $("#gUpd").textContent = !st ? "Waiting for first update" : u ? `Updated ${u.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Scores update automatically";
  $("#gDot").classList.toggle("on", !!u && now - u.getTime() < 12 * 3600e3);

  const empty = msg => `<p class="empty">${msg}</p>`;
  const firstRun = !st ? `Scores for ${esc(L.name)} appear after the next automatic update.` : "";
  $("#gLiveCard").hidden = !live.length;
  $("#gLive").innerHTML = gGroups(live);
  $("#gNext").innerHTML = upcoming.length ? gGroups(upcoming.slice(0, 6)) : empty(firstRun || "No upcoming matches listed yet.");
  $("#gLatest").innerHTML = done.length ? gGroups(done.slice(0, 8)) : empty(firstRun || "No results in the last three weeks.");

  const evU = $("#gEvUp").value, evR = $("#gEvRes").value;
  const ups = upcoming.filter(m => !evU || m.event === evU);
  $("#gUp").innerHTML = ups.length ? `<div class="card">${gGroups(ups)}</div>` : `<div class="card">${empty(firstRun || "No upcoming matches for this filter.")}</div>`;
  const res = done.filter(m => !evR || m.event === evR);
  $("#gRes").innerHTML = res.length ? `<div class="card">${gGroups(res)}</div>` : `<div class="card">${empty(firstRun || "No results for this filter.")}</div>`;
}
async function loadGeneric(bust) {
  try { gStore[current.id] = await getJSON(`leagues/${current.id}.json`, bust); }
  catch (e) { if (!gStore[current.id]) gStore[current.id] = null; }
  const all = gStore[current.id]?.matches || [];
  fillEventSelect($("#gEvUp"), all.filter(m => m.status !== "completed"), `ev.${current.id}.up`);
  fillEventSelect($("#gEvRes"), all.filter(m => m.status === "completed"), `ev.${current.id}.res`);
  renderGeneric();
}

/* ---------- shell: leagues, tabs, routing ---------- */
let LEAGUES = [], current = null, cdlReady = false;
const TABS = { cdl: ["overview", "table", "matches", "history", "titles"], generic: ["overview", "matches", "results"] };
const TAB_LABEL = { overview: "Overview", table: "Table", matches: "Matches", history: "History", titles: "Titles", results: "Results" };
const kind = L => (L.type === "cdl" ? "cdl" : "generic");

function parseHash() {
  const [a, b] = location.hash.slice(1).split("/");
  if (LEAGUES.some(l => l.id === a)) return { league: a, view: b };
  if (TABS.cdl.includes(a)) return { league: "cdl", view: a }; // links from the CDL-only version
  return { league: store.get("league") || "cdl", view: undefined };
}
function go(leagueId, view) {
  const L = LEAGUES.find(l => l.id === leagueId) || LEAGUES[0];
  const v = TABS[kind(L)].includes(view) ? view : "overview";
  const h = `#${L.id}/${v}`;
  if (location.hash !== h) location.hash = h; else route();
}
async function route() {
  const { league, view } = parseHash();
  const L = LEAGUES.find(l => l.id === league) || LEAGUES[0];
  const tabs = TABS[kind(L)];
  const v = tabs.includes(view) ? view : "overview";
  const switched = current?.id !== L.id;
  current = L; store.set("league", L.id);

  $("#lgBadge").textContent = L.short.length > 4 ? L.short.replace(/\s.*/, "") : L.short;
  $("#lgBadge").style.background = L.type === "cdl" ? "" : L.badge;
  $("#lgBadge").style.color = L.type === "cdl" ? "" : "#fff";
  $("#lgName").textContent = L.name;
  $(".league .ct").hidden = false;
  if (L.type !== "cdl") $("#seasonline").textContent = "All events";
  document.title = `${L.short} · Esports Tracker`;
  $("#tabs").innerHTML = tabs.map(t => `<a href="#${L.id}/${t}" ${t === v ? 'aria-current="page"' : ""}>${TAB_LABEL[t]}</a>`).join("");

  const id = kind(L) === "cdl" ? "v-" + v : "v-g-" + v;
  for (const s of document.querySelectorAll("[data-view]")) s.hidden = s.id !== id;
  if (switched) window.scrollTo(0, 0);

  if (kind(L) === "cdl") { await ensureCdl(); $("#seasonline").textContent = `${S.season} season · ${S.game}`; renderLive(); }
  else if (switched || !(L.id in gStore)) await loadGeneric(true);
  else renderGeneric();
}

function renderUpdated() {
  const u = auto.updated ? new Date(auto.updated) : null;
  $("#upd").textContent = u ? `Scores updated ${u.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Scores update automatically";
  $("#dot").classList.toggle("on", !!u && Date.now() - u.getTime() < 6 * 3600e3);
}
function renderLive() { if (current?.type !== "cdl" || !cdlReady) return; merge(); renderTop(); renderStandings(); renderNext(); renderRoad(); renderSchedule(); renderUpdated(); }

/* league sheet */
function openSheet() {
  $("#leagueList").innerHTML = LEAGUES.map(L => `<button class="lrow" data-league="${L.id}" aria-current="${L.id === current.id}">
    <span class="lg" style="${L.type === "cdl" ? "" : `background:${L.badge};color:#fff`}">${esc(L.short.length > 4 ? L.short.replace(/\s.*/, "") : L.short)}</span>
    <span><b>${esc(L.name)}</b><span class="sub">${esc(L.type === "cdl" ? "Full season: table, schedule, history" : "Live scores, schedule and results")}</span></span>
    ${L.id === current.id ? '<span class="tick">✓</span>' : ""}</button>`).join("");
  $("#sheetBg").hidden = false; $("#sheet").hidden = false;
  $("#leagueBtn").setAttribute("aria-expanded", "true");
  $("#sheet").querySelector(".lrow[aria-current=true]")?.focus();
}
function closeSheet() { $("#sheetBg").hidden = true; $("#sheet").hidden = true; $("#leagueBtn").setAttribute("aria-expanded", "false"); $("#leagueBtn").focus(); }

document.addEventListener("click", e => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); go(current.id, g.dataset.goto); return; }
  const t = e.target.closest("button"); if (!t) return;
  if (t.id === "leagueBtn") openSheet();
  else if (t.id === "sheetClose") closeSheet();
  else if (t.dataset.league) { closeSheet(); go(t.dataset.league, "overview"); }
  else if (t.dataset.evf) { evFilter = t.dataset.evf; renderSchedule(); }
  else if (t.dataset.y) { histYear = +t.dataset.y; store.set("cdl.y", histYear); renderHistory(); }
});
$("#sheetBg").addEventListener("click", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
for (const [sel, k] of [["#gEvUp", "up"], ["#gEvRes", "res"]]) $(sel).addEventListener("change", e => { store.set(`ev.${current.id}.${k}`, e.target.value); renderGeneric(); });
window.addEventListener("hashchange", route);
window.addEventListener("online", () => { $("#offline").hidden = true; refresh(); });
window.addEventListener("offline", () => { $("#offline").hidden = false; });

async function refresh() {
  if (!current) return;
  if (current.type !== "cdl") return loadGeneric(true);
  try {
    const [a, o] = await Promise.all([getJSON("results.json", true), getJSON("overrides.json", true).catch(() => ov)]);
    auto = a; ov = o; renderLive();
  } catch (e) { if (!navigator.onLine) $("#offline").hidden = false; }
}

let cdlLoading = null;
function ensureCdl() {
  if (cdlReady) return Promise.resolve();
  return cdlLoading ||= (async () => {
    [S, H] = await Promise.all([getJSON("schedule.json", true), getJSON("history.json")]);
    TEAMS = S.teams;
    CODES = Object.keys(TEAMS).sort((a, b) => TEAMS[a].name.localeCompare(TEAMS[b].name));
    MATCHES = S.matches.map(m => ({ ...m, at: new Date(m.at) })).sort((a, b) => a.at - b.at);
    $("#teamf").innerHTML = `<option value="">All teams</option>` + CODES.map(c => `<option value="${c}">${esc(TEAMS[c].name)}</option>`).join("");
    const savedT = store.get("cdl.t"); if (savedT && TEAMS[savedT]) $("#teamf").value = savedT;
    const savedY = +store.get("cdl.y"); if (H.seasons.some(s => s.y === savedY)) histYear = savedY;
    $("#teamf").addEventListener("change", () => { store.set("cdl.t", $("#teamf").value); renderSchedule(); });
    $("#statef").addEventListener("change", renderSchedule);
    renderHistory(); renderTitles();
    cdlReady = true;
    try { const [a, o] = await Promise.all([getJSON("results.json", true), getJSON("overrides.json", true).catch(() => ov)]); auto = a; ov = o; } catch (e) {}
    if (current?.type === "cdl") $("#seasonline").textContent = `${S.season} season · ${S.game}`;
  })();
}

(async function boot() {
  try { LEAGUES = (await getJSON("leagues.json", true)).leagues; }
  catch (e) { LEAGUES = [{ id: "cdl", name: "Call of Duty League", short: "CDL", game: "Call of Duty", type: "cdl" }]; }
  const tzText = tz ? `Times in your time zone (${tz}).` : "Times in your local time zone.";
  $("#tzn").textContent = tzText;
  for (const el of document.querySelectorAll(".gtz")) el.textContent = tzText;
  $("#offline").hidden = navigator.onLine !== false;
  try { await route(); }
  catch (e) { document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="offline">Couldn't load the league data. Check your connection and reload.</p>`); }
  // Keep scores fresh while the app is open.
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
