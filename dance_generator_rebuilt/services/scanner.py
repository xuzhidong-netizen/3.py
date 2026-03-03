from __future__ import annotations

import json
import re
from pathlib import Path

try:
    from pymediainfo import MediaInfo
except ImportError:  # pragma: no cover - exercised through fallback path
    MediaInfo = None

from dance_generator_rebuilt.domain.models import (
    ALL_KNOWN_DANCES,
    BALLROOM_DANCES,
    COLLECTIVE_DANCES,
    DanceList,
    Distribution,
    FRAME_DANCES,
    HANDLE_DANCES,
    OTHER_DANCES,
    Part,
    Song,
)
from dance_generator_rebuilt.services.utils import file_md5


AUDIO_EXTENSIONS = {".mp3", ".wma", ".ogg", ".m4a", ".flac"}


def fallback_media_info(file_path: Path) -> dict:
    return {
        "file_name": file_path.name,
        "folder_name": str(file_path.parent),
        "duration": 210,
    }


def normalize_dance_label(label: str) -> str:
    if label == "十八摸":
        return "玛卡琳娜"
    if label == "马卡琳娜":
        return "玛卡琳娜"
    if "16步脱掉" in label or "脱掉16步" in label:
        return "青春16步"
    if "维也纳华尔兹" in label:
        return "维也纳"
    if "16步" in label and "青春16步" not in label and "花火16步" not in label:
        return label.replace("16步", "花火16步")
    return label


def clean_song_title(title: str) -> str:
    return re.sub(r"[-_\s]*点播$", "", str(title or "").strip())


def classify_dance_type(dance: str) -> str | None:
    if dance in HANDLE_DANCES:
        return "handle"
    if dance in FRAME_DANCES:
        return "frame"
    if dance in BALLROOM_DANCES:
        return "ballroom"
    if dance in COLLECTIVE_DANCES:
        return "collective"
    return None


def classify_speed(dance: str) -> str | None:
    if dance in ["伦巴", "慢四", "慢三", "华尔兹"]:
        return "slow"
    if dance in ["中三", "中四", "并四"]:
        return "middle"
    if dance in ["平四", "吉特巴", "快三", "维也纳"]:
        return "quick"
    return None


def build_distribution(dances: list[str]) -> Distribution:
    ballroom = [sum(1 for dance in dances if dance == candidate) for candidate in BALLROOM_DANCES]
    ballroom[1] -= ballroom[10]
    return Distribution(
        handle=[sum(1 for dance in dances if dance == candidate) for candidate in HANDLE_DANCES],
        frame=[sum(1 for dance in dances if dance == candidate) for candidate in FRAME_DANCES],
        ballroom=ballroom,
        collective=[sum(1 for dance in dances if dance == candidate) for candidate in COLLECTIVE_DANCES],
    )


def parse_media_info(file_path: Path) -> dict:
    if MediaInfo is None:
        return fallback_media_info(file_path)
    try:
        media_info = MediaInfo.parse(str(file_path))
        tracks = json.loads(media_info.to_json()).get("tracks") or []
        general = tracks[0] if tracks else {}
        duration_ms = general.get("duration", 210_000)
        return {
            "file_name": general.get("file_name_extension", file_path.name),
            "folder_name": general.get("folder_name", str(file_path.parent)),
            "duration": int(float(duration_ms)) // 1000,
        }
    except Exception:
        return fallback_media_info(file_path)


def parse_song(file_path: Path) -> Song:
    info = parse_media_info(file_path)
    filename = info["file_name"].replace(" - ", "-").replace("- ", "-").replace(" -", "-")
    filename = filename.replace("（", "(").replace("）", ")").replace("(1)", "").replace("(2)", "")

    stem = filename[: filename.rfind(".")]
    if len(stem) >= 3 and stem[:2].isdigit() and stem[2] != "步":
        num = int(stem[:2])
        raw = stem[3:]
    else:
        num = None
        raw = stem

    first_dash = raw.find("-")
    dance = ""
    title = raw
    other = None

    if first_dash != -1:
        candidate = normalize_dance_label(raw[:first_dash])
        normalized_raw = normalize_dance_label(raw)
        if candidate in ALL_KNOWN_DANCES:
            dance = candidate
            remainder = normalized_raw[first_dash + 1 :]
            second_dash = remainder.find("-")
            if second_dash == -1 or remainder[second_dash + 1 :].find("-") == -1:
                title = remainder
            else:
                third_index = second_dash + 1 + remainder[second_dash + 1 :].find("-")
                title = remainder[:third_index]
                other = remainder[third_index + 1 :]

    title = clean_song_title(title)
    choose = "点播" in filename or (other is not None and "点播" in other)
    return Song(
        num=num,
        dance=dance,
        title=title,
        choose=choose,
        duration=info["duration"],
        other=other,
        speed=classify_speed(dance),
        dancetype=classify_dance_type(dance),
        md5=file_md5(str(file_path)),
        filepath=file_path,
        filename=file_path.name,
        folder_name=Path(info["folder_name"]).name if info["folder_name"] else None,
    )


def scan_music_directory(directory: str | Path) -> DanceList:
    root = Path(directory)
    paths: list[Path] = []
    for child in root.iterdir():
        if child.is_dir():
            paths.extend(sorted(path for path in child.iterdir() if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS))
        elif child.suffix.lower() in AUDIO_EXTENSIONS:
            paths.append(child)

    parts: list[Part] = []
    current_part: Part | None = None
    current_folder: str | None = None

    for path in paths:
        song = parse_song(path)
        folder_name = path.parent.name if path.parent != root else None
        if current_part is None or folder_name != current_folder:
            current_folder = folder_name
            current_part = Part(part_title=folder_name)
            parts.append(current_part)
        current_part.music.append(song)

    dance_list = DanceList(path=root, parts=parts or [Part(part_title=None)])
    renumber_dance_list(dance_list)
    return dance_list


def renumber_dance_list(dance_list: DanceList) -> None:
    index = 1
    dances: list[str] = []
    for part in dance_list.parts:
        for song in part.music:
            song.num = index
            song.speed = classify_speed(song.dance)
            song.dancetype = classify_dance_type(song.dance)
            dances.append(song.dance)
            index += 1
    dance_list.distribution_cache = build_distribution(dances)


def get_distribution(dance_list: DanceList) -> Distribution:
    cached = dance_list.distribution_cache
    if cached is None:
        dances = [song.dance for song in dance_list.songs]
        cached = build_distribution(dances)
        dance_list.distribution_cache = cached
    return cached
