// Maps the many ways data sources spell a CDL team to the codes used in schedule.json.
// Add a line here if the source starts using a new name or a team rebrands.
const ALIASES = {
  BOS:  ["boston m80", "m80 boston", "m80", "boston breach", "boston"],
  CAR:  ["carolina royal ravens", "royal ravens", "carolina"],
  LAT:  ["los angeles thieves", "la thieves", "lat", "100 thieves", "thieves"],
  MIA:  ["miami heretics", "heretics", "miami"],
  MIN:  ["minnesota g2", "g2 minnesota", "g2 esports", "g2", "minnesota rokkr", "rokkr", "minnesota"],
  C9NY: ["new york cloud9", "cloud9 new york", "cloud9", "c9", "c9ny", "new york"],
  PAR:  ["paris gentle mates", "gentle mates", "gentlemates", "paris"],
  RYD:  ["riyadh falcons", "team falcons", "falcons", "riyadh"],
  TX:   ["texas optic", "optic texas", "optic gaming", "optic", "texas"],
  TOR:  ["toronto koi", "koi", "movistar koi", "toronto ultra", "toronto"],
  VAN:  ["vancouver surge", "surge", "vancouver"],
  VGS:  ["vegas faze", "faze vegas", "faze clan", "faze", "vegas", "las vegas"]
};

const norm = s => String(s ?? "").toLowerCase().replace(/ø/g, "o").replace(/[^a-z0-9]+/g, " ").trim();

// Exact alias first, then the longest alias contained in the name.
const FLAT = Object.entries(ALIASES)
  .flatMap(([code, list]) => list.map(a => [norm(a), code]))
  .sort((x, y) => y[0].length - x[0].length);

export function teamCode(...candidates) {
  for (const c of candidates) {
    const n = norm(c);
    if (!n) continue;
    if (ALIASES[n.toUpperCase().replace(/ /g, "")]) return n.toUpperCase().replace(/ /g, "");
    const exact = FLAT.find(([a]) => a === n);
    if (exact) return exact[1];
  }
  for (const c of candidates) {
    const n = ` ${norm(c)} `;
    if (n.trim().length < 2) continue;
    const hit = FLAT.find(([a]) => a.length > 2 && n.includes(` ${a} `));
    if (hit) return hit[1];
  }
  return null;
}
