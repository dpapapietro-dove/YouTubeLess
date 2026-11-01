"""List the best videos from the trusted channels in curation/channels.json.

Runs on GitHub (YouTube can't be reached from Claude's workspace). For each channel it
checks the channel's real name matches, then keeps its most-watched normal-length videos
that pass the word filters. Writes curation/curated.txt (videos.txt format) and
curation/report.md (what was kept from each channel and why anything was skipped).
"""
import json, re, sys
from pathlib import Path
from yt_dlp import YoutubeDL

here = Path(__file__).parent
cfg = json.loads((here / "channels.json").read_text(encoding="utf-8"))
global_ex = re.compile(cfg["exclude"], re.I)
lo, hi = cfg["min_seconds"], cfg["max_seconds"]

ydl = YoutubeDL({"extract_flat": "in_playlist", "quiet": True, "skip_download": True,
                 "playlistend": 600, "ignoreerrors": True})

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

groups, report, seen = {}, [], set()
total = 0
for ch in cfg["channels"]:
    url = f"https://www.youtube.com/{ch['handle']}/videos"
    try:
        info = ydl.extract_info(url, download=False)
    except Exception as e:  # noqa: BLE001
        info = None
        err = str(e)
    if not info:
        report.append(f"| {ch['handle']} | could not load | 0 | |")
        continue
    real = info.get("channel") or info.get("uploader") or info.get("title") or ""
    real = re.sub(r"\s*-\s*Videos$", "", real)
    if norm(ch["name"]) not in norm(real):
        report.append(f"| {ch['handle']} | NAME MISMATCH: found '{real}', expected '{ch['name']}' (skipped) | 0 | |")
        continue
    ex = re.compile(ch["exclude"], re.I) if ch.get("exclude") else None
    inc = re.compile(ch["include"], re.I) if ch.get("include") else None
    entries = [e for e in (info.get("entries") or []) if e and e.get("id")]
    why = {"short/long": 0, "words": 0, "dup": 0}
    keep = []
    for e in entries:
        t = (e.get("title") or "").strip()
        d = e.get("duration")
        if d is None or d < lo or d > hi:
            why["short/long"] += 1; continue
        if global_ex.search(t) or (ex and ex.search(t)) or (inc and not inc.search(t)):
            why["words"] += 1; continue
        if e["id"] in seen:
            why["dup"] += 1; continue
        keep.append(e)
    keep.sort(key=lambda e: e.get("view_count") or 0, reverse=True)
    keep = keep[: ch["max"]]
    for e in keep:
        seen.add(e["id"])
        title = re.sub(r"\s+", " ", (e.get("title") or "").replace("|", "-")).strip()
        groups.setdefault(ch["group"], []).append(f"https://youtu.be/{e['id']} | {title}")
    total += len(keep)
    report.append(f"| {ch['handle']} | {real} | {len(keep)} | listed {len(entries)}; skipped {why['short/long']} short/long, {why['words']} by word filter |")
    print(f"{ch['handle']}: {real}: kept {len(keep)} of {len(entries)}", flush=True)

out = ["# ---- Curated automatically from trusted channels (curation/channels.json) ----", ""]
for g, lines in groups.items():
    out.append(f"[{g}]")
    out.extend(lines)
    out.append("")
(here / "curated.txt").write_text("\n".join(out), encoding="utf-8")
(here / "report.md").write_text(
    f"# Curation report\n\n**{total} videos** from {len(cfg['channels'])} channels.\n\n"
    "| Handle | Channel | Kept | Notes |\n|---|---|---|---|\n" + "\n".join(report) + "\n",
    encoding="utf-8")
print(f"TOTAL {total}")
