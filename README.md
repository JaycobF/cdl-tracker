# CDL Season Tracker

A fan-made web app for the Call of Duty League: the 2027 season schedule, live standings with form guides, Major and Champs winners, and every season back to 2020. It installs on a phone like a normal app and works offline with the last scores it saw.

Scores update on their own. A scheduled job checks for finished series every 15 minutes during match windows, records them, and republishes the app. Nobody has to enter results.

Not affiliated with Activision or the Call of Duty League.

---

## How it works

```
GitHub Actions (on a schedule)
  └─ scripts/update-scores.mjs
       ├─ asks Cito API for recent CDL matches (only when a match is due)
       ├─ matches them to the schedule in public/data/schedule.json
       └─ writes public/data/results.json and commits it
GitHub Pages
  └─ serves public/ (the app). The app re-reads results.json every 2 minutes while open.
```

- **Data source:** [Cito API](https://citoapi.com), an independent esports data service with a free tier. It isn't official CDL data. The free key is enough for this app because the job only calls the API when a scheduled series should have finished, usually a handful of calls per match day.
- **Qualifier matches** are matched to the schedule by team pair and date, so scores land on the right match even if the source lists the teams the other way round.
- **LAN events** (Major brackets, Champs, Kickoff): every CDL-vs-CDL result from this season that isn't a scheduled qualifier appears under Matches → LAN events. When an event ends, the winner of its last series is recorded as the event winner.
- **Timing:** expect a score roughly 15–30 minutes after a series ends. GitHub's scheduler can run a few minutes late, and GitHub Pages caches files for up to 10 minutes.

## Set it up (about 15 minutes, free)

You need a free GitHub account and a free Cito API key.

### 1. Get an API key
Sign up at [citoapi.com](https://citoapi.com) and copy your API key.

### 2. Create the GitHub repository
1. On GitHub, click **New repository**. Name it `cdl-tracker`, make it **Public** (free GitHub Pages needs a public repo), and create it without a README.
2. Upload the project. The easiest way is [GitHub Desktop](https://desktop.github.com): choose *Add an existing repository*, pick this folder, then *Publish*.
   Uploading through the website also works, but the `.github` folder is hidden on a Mac. Press **Cmd + Shift + .** in Finder to show it, and make sure `.github/workflows/site.yml` gets uploaded.

### 3. Add the API key as a secret
Repository → **Settings → Secrets and variables → Actions → New repository secret**
- Name: `CITO_API_KEY`
- Secret: your key

### 4. Turn on GitHub Pages
Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 5. First run
Repository → **Actions → Update scores and publish → Run workflow**, tick **Check for results even if no match is due**, and run it.
- When it finishes, the deploy step shows your app's address, usually `https://<your-username>.github.io/cdl-tracker/`.
- Open the *update* step's log. A healthy run says something like `Source returned 50 matches, 12 between CDL teams.` Before the season starts it's normal for there to be no new results.

### 6. Put it on your phone
- **iPhone:** open the address in Safari → Share → **Add to Home Screen**.
- **Android:** open it in Chrome → menu → **Install app**.

## Day-to-day

**Fixing a score.** Edit `public/data/overrides.json` on GitHub (pencil icon) and commit. Manual entries always win over automatic ones, and the app republishes within a couple of minutes.

```json
{
  "matches": { "m1-04": { "sa": 3, "sb": 1 } },
  "winners": { "m1": "TX" }
}
```

`sa` is the score of the first team listed for that match id in `schedule.json`. Winner codes: BOS, CAR, LAT, MIA, MIN, C9NY, PAR, RYD, TX, TOR, VAN, VGS. Event ids: kickoff, proam, m1, m2, m3, m4, champs.

**When the league publishes Major II or postseason matches**, add them to `matches` in `public/data/schedule.json` with ids like `m2-01` and stage `m2`. Times are UTC.

**Force a check** any time from Actions → Run workflow.

## If scores stop updating

1. Check the latest run under **Actions**. Red runs show the reason, such as a rejected key or a rate limit.
2. Run the source check on your computer (needs Node 20+):
   ```bash
   CITO_API_KEY=your-key npm run check-source
   ```
   It prints how the first few matches are read. If a team shows `not recognised`, add the spelling to `scripts/lib/teams.mjs`. If scores or times look wrong, the source may have changed its format: the field names are read in `scripts/lib/normalize.mjs`.
3. Use `overrides.json` to fill gaps in the meantime.

To switch to a different data source, replace `scripts/lib/source.mjs` with a function that returns a list of match objects. The rest of the updater stays the same.

## Working on it locally

```bash
npm test            # updater tests with sample source responses
npm start           # serves the app at http://localhost:8080
npm run update      # one update run (needs CITO_API_KEY)
node scripts/update-scores.mjs --fixture test/fixtures/cito-style.json --now 2027-01-18T03:00:00Z --dry-run
```

No packages to install. The updater uses only Node's built-in modules.

## Project layout

```
public/                 the app (GitHub Pages serves this folder)
  index.html, app.js, styles.css, sw.js, manifest.webmanifest, icons/
  data/schedule.json    2027 teams, events and qualifier schedule
  data/history.json     2020–2026 seasons
  data/results.json     written by the updater, don't edit by hand
  data/overrides.json   your manual corrections
scripts/
  update-scores.mjs     the scheduled updater
  check-source.mjs      checks how the data source is being read
  lib/                  team names, response reading, schedule matching, source
test/                   tests and sample responses
.github/workflows/site.yml   schedule, commit and deploy
```
