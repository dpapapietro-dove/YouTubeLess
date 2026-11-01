# YouTubeLess

A kid-safe video page that shows **only** the YouTube videos listed in [`videos.txt`](videos.txt).
No search, no suggested videos, no comments, and nothing in the player can be clicked to leave the page.

## Add or remove videos
- **Easiest:** tell Claude which videos to add or remove.
- **Yourself:** open [`videos.txt`](videos.txt) on github.com, click the pencil icon, paste a YouTube
  link on its own line under a `[group]` heading, then click **Commit changes**. The site updates
  about a minute later. Instructions are at the top of the file.

If a link is wrong, or the video can't be played outside YouTube, it is left out. You can see why on
the **Actions** tab: open the latest "Publish site" run and look under the summary.

## On the Chromebook
Use a Family Link supervised account and set Chrome to **Only allow approved sites**, then approve:
- this site's address (`<your-github-name>.github.io`)
- `youtube-nocookie.com` (the video player)
