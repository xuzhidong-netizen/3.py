from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import quote


AUDIO_EXTENSIONS = {".mp3", ".wma", ".ogg", ".m4a", ".flac"}


def parse_filename(file_name: str) -> dict:
    stem = Path(file_name).stem
    parts = stem.split("-")
    num = None
    dance = ""
    title = stem
    other = None

    if len(parts) >= 3 and parts[0].isdigit():
        num = int(parts[0])
        dance = parts[1].strip()
        title = parts[2].strip()
        if len(parts) > 3:
            other = "-".join(part.strip() for part in parts[3:])

    return {
        "num": num,
        "dance": dance,
        "title": title,
        "other": other,
        "source": file_name,
    }


def build_track(file_path: Path, base_audio_url: str | None) -> dict:
    parsed = parse_filename(file_path.name)
    audio_url = ""
    if base_audio_url:
      audio_url = base_audio_url.rstrip("/") + "/" + quote(file_path.name)
    return {
        "num": parsed["num"],
        "dance": parsed["dance"],
        "title": parsed["title"],
        "other": parsed["other"],
        "choose": "点播" in file_path.name,
        "duration": 210,
        "part_title": "",
        "asset_name": file_path.name,
        "audio_url": audio_url,
        "source": parsed["source"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate cloud playlist json from a local music directory.")
    parser.add_argument("music_dir", help="Directory containing audio files")
    parser.add_argument("output", help="Output json path")
    parser.add_argument("--base-audio-url", default="", help="Public base URL for direct single-track playback")
    parser.add_argument("--title", default="青春舞会舞曲")
    parser.add_argument("--name", default="冬冬")
    parser.add_argument("--club", default="华中大国际标准交谊舞俱乐部")
    parser.add_argument("--place", default="老年活动中心")
    parser.add_argument("--date", default="2026年03月02日")
    parser.add_argument("--weekday", default="周一")
    parser.add_argument("--time", default="19:00")
    parser.add_argument("--download-url", default="https://github.com/xuzhidong-netizen/3.py/releases/download/v1.24-assets/1.24.zip")
    args = parser.parse_args()

    music_dir = Path(args.music_dir)
    tracks = []
    for file_path in sorted(music_dir.iterdir()):
        if file_path.is_file() and file_path.suffix.lower() in AUDIO_EXTENSIONS:
            tracks.append(build_track(file_path, args.base_audio_url or None))

    payload = {
        "version": 1,
        "title": args.title,
        "name": args.name,
        "club": args.club,
        "place": args.place,
        "date": args.date,
        "time": [args.weekday, args.time],
        "download_url": args.download_url,
        "tracks": tracks,
    }

    output = Path(args.output)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
