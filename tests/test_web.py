from __future__ import annotations

import json
from pathlib import Path

from starlette.testclient import TestClient

from dance_generator_rebuilt.domain.models import DanceList, Part, Song
from dance_generator_rebuilt.services.scanner import classify_dance_type, classify_speed
from dance_generator_rebuilt.services.serialization import dance_list_to_dict
from dance_generator_rebuilt import web


def make_song(num: int, dance: str, title: str, duration: int = 180) -> Song:
    return Song(
        num=num,
        dance=dance,
        title=title,
        choose=False,
        duration=duration,
        other=None,
        speed=classify_speed(dance),
        dancetype=classify_dance_type(dance),
        md5=f"md5-{num}",
        filepath=Path(f"/tmp/{num:02d}-{dance}-{title}.mp3"),
        filename=f"{num:02d}-{dance}-{title}.mp3",
    )


def create_client(tmp_path, monkeypatch) -> tuple[TestClient, Path]:
    library_path = tmp_path / "dance_library.json"
    monkeypatch.setattr(web, "LIBRARY_PATH", library_path)
    web.STATE.dance_list = DanceList(parts=[Part(part_title=None)])
    return TestClient(web.create_app()), library_path


def test_home_page_returns_standalone_html(tmp_path, monkeypatch):
    client, _ = create_client(tmp_path, monkeypatch)

    response = client.get("/")

    assert response.status_code == 200
    assert "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/cloud_sample.json" in response.text
    assert "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/web_static/%E7%A4%BA%E8%8C%83%E8%88%9E%E6%9B%B2-top3.zip" in response.text
    assert "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/cloud_full.json" in response.text
    assert "https://github.com/xuzhidong-netizen/2.py/releases/download/v1.24-assets/1.24.zip" in response.text
    assert "./web_static/dance_library_tools.js" in response.text


def test_backend_serves_standalone_alias_and_web_static_pages(tmp_path, monkeypatch):
    client, _ = create_client(tmp_path, monkeypatch)

    standalone_response = client.get("/standalone.html")
    library_response = client.get("/web_static/library.html")

    assert standalone_response.status_code == 200
    assert "青春舞会舞曲" in standalone_response.text
    assert library_response.status_code == 200
    assert "舞曲库" in library_response.text


def test_load_endpoint_requires_path(tmp_path, monkeypatch):
    client, _ = create_client(tmp_path, monkeypatch)

    response = client.post("/api/load", json={"path": ""})

    assert response.status_code == 400
    assert response.json()["error"] == "缺少舞曲目录路径"


def test_check_endpoint_returns_rule_issues(tmp_path, monkeypatch):
    client, _ = create_client(tmp_path, monkeypatch)
    dance_list = DanceList(parts=[Part(part_title=None, music=[make_song(1, "快三", "过长舞曲", duration=241)])])

    response = client.post("/api/check", json={"dance_list": dance_list_to_dict(dance_list)})

    assert response.status_code == 200
    messages = {issue["message"] for issue in response.json()["issues"]}
    assert "过长舞曲 时长超过 4 分钟" in messages


def test_library_get_normalizes_saved_data(tmp_path, monkeypatch):
    client, library_path = create_client(tmp_path, monkeypatch)
    library_path.write_text(
        json.dumps(
            {
                "version": 1,
                "updated_at": "2026-03-03T10:00:00Z",
                "songs": [
                    {"title": "月亮惹的祸", "dance": "并四", "updated_at": "2026-03-03T10:00:00Z"},
                    {"title": "月亮惹的祸", "dance": "并四", "updated_at": "2026-03-02T10:00:00Z"},
                    {"title": "", "dance": "未知"},
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    response = client.get("/api/library")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert len(payload["songs"]) == 1
    assert payload["songs"][0]["title"] == "月亮惹的祸"


def test_library_post_writes_file_and_returns_commit_url(tmp_path, monkeypatch):
    client, library_path = create_client(tmp_path, monkeypatch)
    monkeypatch.setattr(web, "sync_library_data_to_github", lambda data: "https://example.com/commit/1")

    response = client.post(
        "/api/library",
        json={
            "data": {
                "version": 1,
                "updated_at": "2026-03-03T12:00:00Z",
                "songs": [
                    {"title": "夜来香", "dance": "伦巴", "updated_at": "2026-03-03T12:00:00Z"}
                ],
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["commit_url"] == "https://example.com/commit/1"
    saved = json.loads(library_path.read_text(encoding="utf-8"))
    assert saved["songs"][0]["title"] == "夜来香"
