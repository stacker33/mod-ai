# Mod-AI — NBA recaps in Hebrew for Sport5 editors

Every few minutes (GitHub Actions, triggered by cron-job.org) the runner checks ESPN's scoreboard. Each game that has just ended gets, within minutes: verified facts, a 1–3 paragraph Hebrew block for the nightly closing page, a separate article for Deni Avdija (and short items for other Israelis), a stand-alone article for big games — sent to the Mod-AI Telegram channel and published to an encrypted page (password needed).

```
node scripts/tick.js            # one live check (what the workflow runs)
node scripts/tick.js --loop     # keep checking every 5 minutes on this computer
node scripts/write.js 20261027  # backfill drafts for a night from facts on disk
PAGE_PASSWORD=… node scripts/site.js && node scripts/serve.js   # build and preview the page
```

Setup (GitHub): secrets `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `PAGE_PASSWORD`; variable `TELEGRAM_CHAT`; Pages source = GitHub Actions; a cron-job.org job that triggers the "Mod-AI tick" workflow every 5 minutes. Copyrighted texts (Sport5 examples, ESPN/AP articles) are never committed: the examples are downloaded at run time (config/style_sources.json), drafts live in the Actions cache.

## Facts engine

Builds a verified facts sheet for every finished NBA game. No AI in this step: every number comes from ESPN's box score and play-by-play, and each game is self-checked before anything may be written from it.

```
npm test                       # 10 tests on saved games
node scripts/facts.js          # last night's games
node scripts/facts.js 20261101 # a specific US date
```

Output: `out/<date>/report.md` (review sheet), `out/<date>/<gameId>.json` (facts for the writer), `out/<date>/raw/` (ESPN source, kept for re-checking).

## Checks (a game with a failed check is blocked)
- game is final
- quarter scores add up to the final score
- player points add up to the team score
- the score rebuilt from the play-by-play baskets equals the box score
- largest lead and lead changes match ESPN's own team stats (warning)

ESPN's per-play running score is sometimes corrupt (12 of 64 games tested, Oct 24 – Nov 1 2026). The engine ignores it and rebuilds the score from the baskets, which matched the box score in 64 of 64 games.

## Not in the data (listed under "research", never stated as fact)
Career/season highs, injury severity, quotes, streaks and standings meaning.

## Israeli players (config/israelis.json)
For every game of Portland / Brooklyn the run adds a track per Israeli: his line (checked play-by-play vs box score), points by quarter, hottest burst, who he assisted, crunch-time actions, go-ahead baskets, foul trouble, technicals, verified career/season highs, streaks and career triple-double count (ESPN game log, regular season, only games before this one), previous and next game (Israel time), team streak. DNP and "not in the box score" are reported too.

## Color
Technicals (not 3-seconds), flopping, double technicals, flagrants, ejections, coach's challenges, buzzer baskets at the end of quarters — from the play-by-play. ESPN highlight-clip titles are listed as leads, not facts.

## Files
- `src/espn.js` — the only file that knows ESPN; replace it for a paid provider
- `src/facts.js` — the engine
- `src/game.js` — runs facts + color + Israeli tracks for one game
- `src/player.js` — the Israeli player track
- `src/gamelog.js` — career history (past seasons cached in cache/gamelog)
- `src/color.js` — the color layer
- `src/report.js` — the review sheet
- `style/` — Sport5 examples and STYLE.md (for the Hebrew writer, next step)
- `config/israelis.json` — players always flagged (exact ESPN names)
