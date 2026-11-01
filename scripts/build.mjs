// Turns videos.txt into site/videos.json. Runs on GitHub on every change to the list.
// Looks up each video's title on YouTube and leaves out videos that are private,
// deleted, or not allowed to play on other sites.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const text = readFileSync(new URL('videos.txt', root), 'utf8');

function videoId(s) {
  s = s.trim();
  const pats = [
    /youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of pats) { const m = p.exec(s); if (m) return m[1]; }
  return null;
}

async function lookup(id) {
  const url = 'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + id);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (r.ok) { const j = await r.json(); return { ok: true, title: j.title || '' }; }
    if ([400, 401, 404].includes(r.status)) return { ok: false };
  } catch {}
  return { ok: true, title: '' };   // could not check: keep the video
}

let siteName = 'My Videos';
const groups = [];
let current = null;
const seen = new Set();
const warnings = [];
const lines = text.split(/\r?\n/);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const n = i + 1;
  if (!line || line.startsWith('#')) continue;
  let m;
  if ((m = /^site\s*name\s*:\s*(.+)$/i.exec(line))) { siteName = m[1].trim(); continue; }
  if ((m = /^\[(.+)\]$/.exec(line))) { current = { name: m[1].trim(), videos: [] }; groups.push(current); continue; }

  const bar = line.indexOf('|');
  const link = bar >= 0 ? line.slice(0, bar).trim() : line;
  let title = bar >= 0 ? line.slice(bar + 1).trim() : '';
  const id = videoId(link);
  if (!id) { warnings.push(`Line ${n}: could not find a YouTube video in: ${line}`); continue; }
  if (seen.has(id)) continue;
  seen.add(id);

  if (!current) { current = { name: 'Videos', videos: [] }; groups.push(current); }
  current.videos.push({ id, title, line: n });
}

// Check every video with YouTube, 16 at a time, so a long list still builds quickly.
const all = groups.flatMap(g => g.videos);
for (let i = 0; i < all.length; i += 16) {
  await Promise.all(all.slice(i, i + 16).map(async v => { v.info = await lookup(v.id); }));
}
for (const g of groups) {
  g.videos = g.videos.filter(v => {
    if (!v.info.ok) { warnings.push(`Line ${v.line}: video ${v.id} is private, deleted, or does not allow playing on other sites. It was left out.`); return false; }
    return true;
  }).map(v => ({ id: v.id, title: v.title || v.info.title || 'Video' }));
}

const out = { siteName, categories: groups.filter(g => g.videos.length) };
writeFileSync(new URL('site/videos.json', root), JSON.stringify(out, null, 2));

// facts.txt -> site/facts.json (one fact per line; # lines and blank lines are skipped)
const factSeen = new Set();
const facts = [];
for (const raw of readFileSync(new URL('facts.txt', root), 'utf8').split(/\r?\n/)) {
  const f = raw.trim();
  if (!f || f.startsWith('#')) continue;
  const key = f.toLowerCase();
  if (factSeen.has(key)) continue;
  factSeen.add(key);
  facts.push(f);
}
writeFileSync(new URL('site/facts.json', root), JSON.stringify(facts));
console.log(`Published ${facts.length} facts.`);

const count = out.categories.reduce((a, g) => a + g.videos.length, 0);
console.log(`Published ${count} videos in ${out.categories.length} groups.`);
for (const w of warnings) console.log(`::warning title=videos.txt::${w}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### ${count} videos published\n` + (warnings.length ? '\n**Problems:**\n' + warnings.map(w => `- ${w}`).join('\n') + '\n' : ''));
}
