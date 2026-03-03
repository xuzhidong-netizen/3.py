from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from dance_generator_rebuilt.domain.models import DanceList, Part, Song
from dance_generator_rebuilt.services.rules import validate_dance_list
from dance_generator_rebuilt.services.scanner import (
    classify_dance_type,
    classify_speed,
    parse_media_info,
    parse_song,
)
from dance_generator_rebuilt.services.serialization import dance_list_from_dict, dance_list_to_dict


def make_song(
    *,
    num: int,
    dance: str,
    title: str,
    duration: int = 180,
    md5: str | None = None,
    choose: bool = False,
) -> Song:
    return Song(
        num=num,
        dance=dance,
        title=title,
        choose=choose,
        duration=duration,
        other=None,
        speed=classify_speed(dance),
        dancetype=classify_dance_type(dance),
        md5=md5 or f"md5-{num}",
        filepath=Path(f"/tmp/{num:02d}-{dance}-{title}.mp3"),
        filename=f"{num:02d}-{dance}-{title}.mp3",
    )


def test_parse_media_info_falls_back_when_mediainfo_is_unavailable(tmp_path, monkeypatch):
    sample = tmp_path / "01-并四-月亮惹的祸.mp3"
    sample.write_bytes(b"fake")
    monkeypatch.setattr("dance_generator_rebuilt.services.scanner.MediaInfo", None)

    info = parse_media_info(sample)

    assert info["file_name"] == sample.name
    assert info["folder_name"] == str(sample.parent)
    assert info["duration"] == 210


def test_parse_song_strips_choose_suffix_and_sets_flags():
    fake_path = Path("/tmp/第一场/03-并四-月亮惹的祸-点播.mp3")
    with (
        patch(
            "dance_generator_rebuilt.services.scanner.parse_media_info",
            return_value={
                "file_name": fake_path.name,
                "folder_name": str(fake_path.parent),
                "duration": 196,
            },
        ),
        patch("dance_generator_rebuilt.services.scanner.file_md5", return_value="abc123"),
    ):
        song = parse_song(fake_path)

    assert song.num == 3
    assert song.dance == "并四"
    assert song.title == "月亮惹的祸"
    assert song.choose is True
    assert song.duration == 196
    assert song.folder_name == "第一场"


def test_validate_dance_list_reports_duplicate_collective_long_song_and_unknown_dance():
    dance_list = DanceList(
        parts=[
            Part(
                part_title="测试场",
                music=[
                    make_song(num=1, dance="青春16步", title="开场", duration=185),
                    make_song(num=2, dance="青春16步", title="再来一次", duration=185),
                    make_song(num=3, dance="快三", title="快曲超时", duration=241),
                    make_song(num=4, dance="", title="未识别舞曲", duration=190),
                ],
            )
        ]
    )

    issues = validate_dance_list(dance_list)
    messages = {issue.message for issue in issues}

    assert "青春16步 重复" in messages
    assert "快曲超时 时长超过 4 分钟" in messages
    assert "未识别舞曲 无法识别舞种" in messages


def test_serialization_round_trip_preserves_song_structure():
    original = DanceList(
        title="测试舞会",
        name="测试员",
        date="2026年03月03日",
        club="华中大国际标准交谊舞俱乐部",
        place="老年活动中心",
        time=["周二", "19:00"],
        path=Path("/tmp/music"),
        parts=[
            Part(
                part_title="第一场",
                music=[
                    make_song(num=1, dance="并四", title="月亮惹的祸"),
                    make_song(num=2, dance="伦巴", title="夜来香", choose=True),
                ],
            )
        ],
    )

    payload = dance_list_to_dict(original)
    restored = dance_list_from_dict(payload)

    assert restored.title == original.title
    assert restored.name == original.name
    assert restored.parts[0].part_title == "第一场"
    assert [song.title for song in restored.parts[0].music] == ["月亮惹的祸", "夜来香"]
    assert restored.parts[0].music[1].choose is True
