// Turns a match object from the data source into one shape the updater understands.
// The source's exact field names aren't documented, so this accepts the common variants.
import { teamCode } from "./teams.mjs";

const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const num = v => (v === undefined || v === null || v === "" || isNaN(+v) ? null : +v);

function side(t, fallbackScore) {
  if (t == null) return null;
  if (typeof t === "string") return { name: t, short: "", code: teamCode(t), score: num(fallbackScore) };
  const name = pick(t, "name", "team_name", "teamName", "full_name", "fullName", "title", "team.name", "opponent.name");
  const short = pick(t, "acronym", "abbreviation", "abbr", "short_name", "shortName", "teamTag", "tag", "code", "slug", "team.acronym", "team.slug", "opponent.acronym");
  const score = num(pick(t, "score", "series_score", "seriesScore", "maps_won", "mapsWon", "wins", "result.score", "result.gameWins", "result.game_wins", "gameWins")) ?? num(fallbackScore);
  const logo = pick(t, "logoUrl", "logo_url", "logo", "image_url", "imageUrl", "team.logoUrl", "team.logo");
  return { name: String(name ?? short ?? ""), short: short ? String(short) : "", code: teamCode(name, short), score, logo: typeof logo === "string" && /^https:\/\//.test(logo) ? logo : "" };
}

export function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const k of ["data", "matches", "results", "items", "schedule", "events"]) {
    const v = payload[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") { const inner = listFrom(v); if (inner.length) return inner; }
  }
  return [];
}

export function normalizeMatch(m) {
  let a, b;
  const teams = pick(m, "teams", "opponents", "participants", "competitors");
  if (Array.isArray(teams) && teams.length >= 2) {
    const sc = pick(m, "scores", "score");
    a = side(teams[0], Array.isArray(sc) ? sc[0] : undefined);
    b = side(teams[1], Array.isArray(sc) ? sc[1] : undefined);
  } else {
    a = side(pick(m, "team_a", "teamA", "team1", "home", "home_team", "homeTeam", "team_1"),
             pick(m, "team_a_score", "teamAScore", "score_a", "scoreA", "team1_score", "team1Score", "home_score", "homeScore", "score.team_a", "score.home", "score1", "liveState.team1Score"));
    b = side(pick(m, "team_b", "teamB", "team2", "away", "away_team", "awayTeam", "team_2"),
             pick(m, "team_b_score", "teamBScore", "score_b", "scoreB", "team2_score", "team2Score", "away_score", "awayScore", "score.team_b", "score.away", "score2", "liveState.team2Score"));
    // Some sources put team names beside the team objects rather than inside them.
    const n1 = pick(m, "team1Name", "team1_name", "teamAName", "home_name"), n2 = pick(m, "team2Name", "team2_name", "teamBName", "away_name");
    if (n1) a = a && a.name ? a : { ...(a || { score: null, short: "" }), name: String(n1), code: teamCode(n1, a?.short) };
    if (n2) b = b && b.name ? b : { ...(b || { score: null, short: "" }), name: String(n2), code: teamCode(n2, b?.short) };
  }
  if ((a?.score == null || b?.score == null) && typeof m.score === "string") {
    const mm = m.score.match(/(\d+)\s*[-–:]\s*(\d+)/);
    if (mm && a && b) { a.score = +mm[1]; b.score = +mm[2]; }
  }
  const atRaw = pick(m, "start_time", "startTime", "startsAt", "starts_at", "startingAt", "starting_at", "scheduled_at", "scheduledAt", "begin_at", "beginAt", "start_at", "startAt", "date", "datetime", "time", "match_date", "matchDate", "timestamp");
  let at = null;
  if (atRaw !== undefined) {
    const d = typeof atRaw === "number" ? new Date(atRaw < 1e12 ? atRaw * 1000 : atRaw) : new Date(atRaw);
    if (!isNaN(d)) at = d;
  }
  const statusRaw = String(pick(m, "status", "state", "match_status", "matchStatus") ?? "").toLowerCase();
  const winnerRaw = pick(m, "winner", "winner_name", "winnerName", "winner.name", "winning_team", "winningTeam");
  let status = "unknown";
  if (/(complete|finish|final|ended|done|closed|over|result)/.test(statusRaw)) status = "completed";
  else if (/(upcoming|scheduled|not.?started|unstarted|pending|tbd)/.test(statusRaw)) status = "upcoming";
  else if (/(live|running|progress|ongoing|started)/.test(statusRaw)) status = "live";
  else if (winnerRaw) status = "completed";
  const event = pick(m, "league.name", "tournament.name", "tournament_name", "tournamentName", "event.name", "event_name", "eventName", "league_name", "leagueName", "serie.full_name", "stage", "tournament", "event", "league");
  const boRaw = pick(m, "best_of", "bestOf", "bo", "number_of_games", "numberOfGames", "strategy.count", "match.strategy.count", "strategy");
  const bestOf = typeof boRaw === "string" ? num((boRaw.match(/\d+/) || [])[0]) : num(boRaw);
  return {
    id: String(pick(m, "id", "match_id", "matchId", "slug") ?? ""),
    a, b, at, status,
    winner: winnerRaw && typeof winnerRaw === "object" ? teamCode(winnerRaw.name, winnerRaw.acronym, winnerRaw.slug) : teamCode(winnerRaw),
    event: typeof event === "string" ? event : "",
    bestOf
  };
}

// A finished series has a clear winner on a best-of score (first to 3, 4 or 5 maps).
export function isFinal(n) {
  if (!n.a || !n.b || n.a.score == null || n.b.score == null) return false;
  if (n.status === "live" || n.status === "upcoming") return false;
  const hi = Math.max(n.a.score, n.b.score), lo = Math.min(n.a.score, n.b.score);
  if (hi === lo) return false;
  if (n.status === "completed") return true;
  return [3, 4, 5].includes(hi) && lo < hi;
}
