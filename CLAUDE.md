# YouTubeLess

Kid-safe video page for Dev's son, used on a Chromebook. Hosted on GitHub Pages.
Dev never edits code; Claude makes every change. Dev may edit `videos.txt` on github.com.

## How it works
- `videos.txt` is the allowlist: `#` comments, `Site name: X`, `[Group]` headings, one link per line,
  optional `| Custom title`. Accepts watch, youtu.be, shorts, embed, live links or a bare 11-char ID.
- `.github/workflows/publish.yml` runs on every push to main (and weekly): `node scripts/build.mjs`
  turns videos.txt into `site/videos.json` (titles via YouTube oEmbed; 400/401/404 = private, deleted
  or embedding disabled, so the video is dropped with a warning), then deploys `site/` to Pages.
- `facts.txt` (~2,000 one-line facts for a 7-year-old, `#` comments) is built into `site/facts.json`.
- `site/` is static: index.html, app.js, app.css, icon.svg. All paths are relative (site lives under /<repo>/).

## Lock-down rules (keep these when changing anything)
- Player uses the IFrame API on `youtube-nocookie.com` with controls=0, rel=0, fs=0, disablekb=1,
  iv_load_policy=3. Our own controls are drawn on top.
- A transparent `#shield` div covers the iframe so nothing inside YouTube's player is clickable.
- Pause and end states show our own `#cover`, hiding YouTube's "more videos" and end screens.
- Ads: YouTube never reports PLAYING during an ad, so the player starts muted behind a cover showing a
  "Fun Fact!" quiz (`facts.txt` -> `site/facts.json`; a NEW fact every view, via a localStorage counter stepping
  by a prime coprime to the count). Each fact marks one word as `[right|wrong|wrong]`. He reads the whole fact
  (5-14 s), then picks the blanked word from 3 buttons; wrong = read again. Dev's rule: Skip OR Continue, never
  both, and he must answer to get past the cover. So: right answer + video already PLAYING (no ad, or ad ended)
  = video starts; right answer during an ad = `#stage.ad-window` clip-paths a hole in the bottom-right 30%x28%
  of #cover/#shield so he can tap YouTube's Skip, and the next PLAYING starts the video. PLAYING before the
  answer is paused and waits. 45 s after a right answer with no PLAYING, a Continue button appears.
  In ad-window the cover keeps clear of the bottom 28cqh (#stage is a size container) and hides "All videos",
  so nothing overlaps the Skip hint. Mid-roll ads are muted and covered (no quiz).
- Full screen is applied to our `#stage` (not the iframe) so the shield stays in place.
- `openVideo` refuses any id not in the allowlist, including ids in the URL hash.
- Chromebook: Family Link "approved sites only" with the Pages domain, youtube-nocookie.com AND www.youtube-nocookie.com
  (Family Link filters the player iframe too; missing www = white player). Never approve youtube.com.

## Home screen
- No group tabs. Home shows 10 videos (SHOW_COUNT) from one queue mixed round-robin across groups
  (localStorage `ytl-lineup` {queue, shown}). Shown videos stay until watched; when the real video starts
  (beginWatching) it leaves the screen and moves to the back of the queue. New list entries go in front of
  watched ones. Empty slots prefer groups not already on screen.
- 14-day rule (Dev): if no video in a group has been watched IN FULL for 14 days (clock starts when the group
  first appears, `lineup.seen`), home shows only one video from that group (`lineup.must`) with a note, and
  openVideo refuses everything else until it is finished. Full = ENDED with >=90% of it played in that viewing
  (`viewSecs`), so seeking to the end doesn't count. Most overdue group first; unplayable must-video is swapped.
- Watch history per video in localStorage `ytl-history` (title, group, views, seconds watched, furthest
  point, duration, times finished `done`, first/last time). It lives only on the Chromebook for now.

## Curated list
- videos.txt holds ~950 hand-reviewed videos from trusted channels (curation/channels.json), made by the
  manual "Curate" workflow (curation/curate.py, yt-dlp). Dev's taste: smart kid (7), CrunchLabs/Mark Rober
  level, nothing babyish, no gamers, no politics ("not liberal leaning"), no weapons/gore/scams/dating.
- curation/blocked.txt lists IDs Claude rejected on review; curate.py never picks them again. Review every
  title of a new curate run before swapping it into videos.txt.

## Gotchas
- CSS has `[hidden]{display:none!important}` because `.cover` sets display:flex.
- `site/videos.json` and `site/facts.json` are generated, not committed.
- Cover is black with yellow (#ffd60a) text only, no thumbnail. Player page must fit one screen (no scroll), with a Home button in the top bar.
- Testing: YouTube is unreachable from the cloud sandbox. Serve `site/` under a subpath and stub
  `https://www.youtube.com/iframe_api` in Playwright.
