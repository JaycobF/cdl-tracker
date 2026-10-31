"use strict";
/* CDL Season Tracker — reads data/*.json, which the scheduled updater keeps current. */

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

/* ---------- shell ---------- */
const VIEWS = ["overview", "table", "matches", "history", "titles"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  for (const s of document.querySelectorAll("[data-view]")) s.hidden = s.id !== "v-" + v;
  for (const a of document.querySelectorAll(".tabs a")) { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
}
function renderUpdated() {
  const u = auto.updated ? new Date(auto.updated) : null;
  $("#upd").textContent = u ? `Scores updated ${u.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Scores update automatically";
  $("#dot").classList.toggle("on", !!u && Date.now() - u.getTime() < 6 * 3600e3);
}
function renderLive() { merge(); renderTop(); renderStandings(); renderNext(); renderRoad(); renderSchedule(); renderUpdated(); }

document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.evf) { evFilter = t.dataset.evf; renderSchedule(); }
  else if (t.dataset.y) { histYear = +t.dataset.y; store.set("cdl.y", histYear); renderHistory(); }
});
window.addEventListener("hashchange", route);
window.addEventListener("online", () => { $("#offline").hidden = true; refresh(); });
window.addEventListener("offline", () => { $("#offline").hidden = false; });

async function refresh() {
  try {
    const [a, o] = await Promise.all([getJSON("results.json", true), getJSON("overrides.json", true).catch(() => ov)]);
    auto = a; ov = o; renderLive();
  } catch (e) { if (!navigator.onLine) $("#offline").hidden = false; }
}

(async function boot() {
  try {
    [S, H] = await Promise.all([getJSON("schedule.json", true), getJSON("history.json")]);
  } catch (e) {
    document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="offline">Couldn't load the season data. Check your connection and reload.</p>`);
    return;
  }
  TEAMS = S.teams;
  CODES = Object.keys(TEAMS).sort((a, b) => TEAMS[a].name.localeCompare(TEAMS[b].name));
  MATCHES = S.matches.map(m => ({ ...m, at: new Date(m.at) })).sort((a, b) => a.at - b.at);
  $("#seasonline").textContent = `${S.season} season · ${S.game}`;
  $("#teamf").innerHTML = `<option value="">All teams</option>` + CODES.map(c => `<option value="${c}">${esc(TEAMS[c].name)}</option>`).join("");
  const savedT = store.get("cdl.t"); if (savedT && TEAMS[savedT]) $("#teamf").value = savedT;
  const savedY = +store.get("cdl.y"); if (H.seasons.some(s => s.y === savedY)) histYear = savedY;
  $("#teamf").addEventListener("change", () => { store.set("cdl.t", $("#teamf").value); renderSchedule(); });
  $("#statef").addEventListener("change", renderSchedule);
  $("#tzn").textContent = tz ? `Times in your time zone (${tz}).` : "Times in your local time zone.";
  $("#offline").hidden = navigator.onLine !== false;
  route(); renderHistory(); renderTitles(); renderLive();
  await refresh();
  // Keep scores fresh while the app is open.
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 120e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
