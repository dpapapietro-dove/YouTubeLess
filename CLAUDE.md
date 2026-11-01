# YouTubeLess

Kid-safe video page for Dev's son, used on a Chromebook. Hosted on GitHub Pages.
Dev never edits code; Claude makes every change. Dev may edit `videos.txt` on github.com.

## How it works
- `videos.txt` is the allowlist: `#` comments, `Site name: X`, `[Group]` headings, one link per line,
  optional `| Custom title`. Accepts watch, youtu.be, shorts, embed, live links or a bare 11-char ID.
- `.github/workflows/publish.yml` runs on every push to main (and weekly): `node scripts/build.mjs`
  turns videos.txt into `site/videos.json` (titles via YouTube oEmbed; 400/401/404 = private, deleted
  or embedding disabled, so the video is dropped with a warning), then deploys `site/` to Pages.
- `site/` is static: index.html, app.js, app.css, icon.svg. All paths are relative (site lives under /<repo>/).

## Lock-down rules (keep these when changing anything)
- Player uses the IFrame API on `youtube-nocookie.com` with controls=0, rel=0, fs=0, disablekb=1,
  iv_load_policy=3. Our own controls are drawn on top.
- A transparent `#shield` div covers the iframe so nothing inside YouTube's player is clickable.
- Pause and end states show our own `#cover`, hiding YouTube's "more videos" and end screens.
- Ads: YouTube never reports PLAYING during an ad, so the player starts muted behind a cover showing
  the daily STEM fact (`site/facts.js`, one per day in order). On the first PLAYING we pause it and show
  "Continue to video"; pressing it (`started = true`) unmutes and plays. 45 s fallback shows the button anyway.
  Mid-roll ads (UNSTARTED after start) are muted and covered. Sound button state is `wantSound`.
- Full screen is applied to our `#stage` (not the iframe) so the shield stays in place.
- `openVideo` refuses any id not in the allowlist, including ids in the URL hash.
- Chromebook: Family Link "approved sites only" with the Pages domain and youtube-nocookie.com.

## Gotchas
- CSS has `[hidden]{display:none!important}` because `.cover` sets display:flex.
- `site/videos.json` is generated, not committed.
- Testing: YouTube is unreachable from the cloud sandbox. Serve `site/` under a subpath and stub
  `https://www.youtube.com/iframe_api` in Playwright.
