# Esports Tracker

A fan-made web app for following esports leagues on your phone. Tap the league name at the top to switch between:

| League | What you get |
|---|---|
| **Call of Duty League** | Full 2027 season: table with form guide, every qualifier, Major and Champs winners, history back to 2020 |
| **League of Legends** | Live scores, upcoming matches and results across events (LCK, LEC, LCS, Worlds…) |
| **Counter-Strike 2** | Live scores, upcoming matches and results |
| **Dota 2** | Live scores, upcoming matches and results |

Scores update on their own. A scheduled job checks for new results, saves them and republishes the app. It installs on a phone like a normal app and works offline with the last scores it saw.

Not affiliated with Activision, Riot Games, Valve or any league.

---

## How it works

```
GitHub Actions (every 15 minutes)
  └─ scripts/update-scores.mjs
       ├─ for each league in public/data/leagues.json, decides whether it's due
       ├─ asks Cito API for new results only when it is
       └─ writes public/data/… and commits the changes
GitHub Pages
  └─ serves public/ (the app). The app re-reads its league's data every 2 minutes while open.
```

- **Data source:** [Cito API](https://citoapi.com), an independent esports data service. It isn't official league data. One key covers every game, and only you need it: people you share the app with never see or need a key.
- **CDL** uses the hand-built 2027 schedule (`schedule.json`). Results are matched to each scheduled series by team pair and date, so they land in the right place even if the source lists the teams the other way round.
- **LoL, CS2 and Dota 2** keep a rolling three weeks of results and three weeks of upcoming matches, straight from the source.

## Staying within the free plan

Every check is one API call, and Cito's free key has a monthly allowance. Two settings in `public/data/leagues.json` keep you inside it:

- **`"plan"`**: `"free"` or `"starter"`. This picks how often each league checks:

  | | free | starter |
  |---|---|---|
  | CDL | every 15 min, only while a scheduled series is waiting for its score | same |
  | LoL / CS2 / Dota 2 results | every 8 hours, only when a match should have finished | every 30 min |
  | LoL / CS2 / Dota 2 upcoming list | once a day | every 6 hours |

- **`"monthlyCallLimit"`**: the updater stops calling for the rest of the month when it reaches this number (default 480). Calls used so far are in `public/data/usage.json`.

On the free plan, LoL, CS2 and Dota 2 results show up a few hours after a match. For quicker scores across all four leagues, move to Cito's paid starter plan, set `"plan": "starter"`, and raise `monthlyCallLimit` to your plan's allowance. Check Cito's pricing page for current limits.

**Adding or removing a league:** edit the `leagues` list in `leagues.json`. Remove an entry to hide a league and stop its checks. Valorant, Rocket League and Overwatch aren't offered by the source yet. Apex Legends is, but its battle-royale scoring needs its own screens.

## Set it up

You need a free GitHub account and a Cito API key.

1. **API key:** sign up at [citoapi.com](https://citoapi.com) and copy your key.
2. **Repository:** create a public repository on GitHub and push this folder to it (GitHub Desktop is easiest). On a Mac, press **Cmd + Shift + .** in Finder to see the hidden `.github` folder, which must be included.
3. **Secret:** Settings → Secrets and variables → Actions → New repository secret. Name `CITO_API_KEY`, value your key.
4. **Pages:** Settings → Pages → Source: **GitHub Actions**.
5. **First run:** Actions → **Update scores and publish** → Run workflow, tick **Check for results even if no match is due**. The deploy step shows your app's address.
6. **Phone:** open the address. On iPhone, tap Safari's Share button → **Add to Home Screen**. On Android, open the Chrome menu → **Install app**.

## Day-to-day

**Fixing a CDL score.** Edit `public/data/overrides.json` on GitHub and commit. Manual entries always win.

```json
{ "matches": { "m1-04": { "sa": 3, "sb": 1 } }, "winners": { "m1": "TX" } }
```

`sa` is the score of the first team listed for that match id in `schedule.json`. Team codes: BOS, CAR, LAT, MIA, MIN, C9NY, PAR, RYD, TX, TOR, VAN, VGS. Event ids: kickoff, proam, m1, m2, m3, m4, champs.

**When the CDL publishes Major II or postseason matches**, add them to `matches` in `schedule.json` with ids like `m2-01` and stage `m2`. Times are in UTC.

**Force a check** any time from Actions → Run workflow.

## If scores stop updating

1. Open the latest run under **Actions**. The *Fetch new results* step lists each league, what it fetched and how many API calls it used this month.
2. Check how a league's data is being read, on your computer (Node 20+):
   ```bash
   CITO_API_KEY=your-key npm run check-source                      # CDL
   CITO_API_KEY=your-key npm run check-source -- --league cs2      # lol, cs2 or dota2
   ```
   If teams, times or scores look wrong, the source may have changed its format. Field names are read in `scripts/lib/normalize.mjs`, and CDL team spellings live in `scripts/lib/teams.mjs`.
3. If a league's endpoint moves, update its `api` paths in `leagues.json`. Each list is tried in order until one answers.

## Working on it locally

```bash
npm test            # updater tests with sample responses for every league
npm start           # serves the app at http://localhost:8080
npm run update      # one update run (needs CITO_API_KEY)
FIXTURE_DIR=test/fixtures/api node scripts/update-scores.mjs --force --dry-run   # full run from saved responses
```

No packages to install. The updater uses only Node's built-in modules.

## Project layout

```
public/                       the app (GitHub Pages serves this folder)
  index.html, app.js, styles.css, sw.js, manifest.webmanifest, icons/
  data/leagues.json           leagues, their API paths, plan and monthly limit
  data/schedule.json          CDL 2027 teams, events and qualifier schedule
  data/history.json           CDL 2020–2026 seasons
  data/results.json           CDL results (written by the updater)
  data/overrides.json         your manual CDL corrections
  data/leagues/<id>.json      other leagues' matches (written by the updater)
  data/usage.json             API calls used this month (written by the updater)
scripts/
  update-scores.mjs           the scheduled updater
  check-source.mjs            checks how a league's data is being read
  lib/                        response reading, CDL matching, other leagues, source
test/                         tests and sample responses
.github/workflows/site.yml    schedule, commit and deploy
```
