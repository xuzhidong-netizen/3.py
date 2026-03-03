from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import asdict
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote
from urllib.request import Request as UrlRequest, urlopen

import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from dance_generator_rebuilt.domain.models import Part
from dance_generator_rebuilt.services.rules import validate_dance_list
from dance_generator_rebuilt.services.scanner import parse_song, scan_music_directory
from dance_generator_rebuilt.services.serialization import dance_list_from_dict, dance_list_to_dict, default_date_string


PACKAGE_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = PACKAGE_ROOT / "web_static"
WORKSPACE_ROOT = PACKAGE_ROOT.parent
LIBRARY_PATH = STATIC_ROOT / "dance_library.json"
LIBRARY_GITHUB_OWNER = os.getenv("DANCE_LIBRARY_GITHUB_OWNER", "xuzhidong-netizen")
LIBRARY_GITHUB_REPO = os.getenv("DANCE_LIBRARY_GITHUB_REPO", "3.py")
LIBRARY_GITHUB_BRANCH = os.getenv("DANCE_LIBRARY_GITHUB_BRANCH", "main")
LIBRARY_GITHUB_PATH = os.getenv("DANCE_LIBRARY_GITHUB_PATH", "dance_generator_rebuilt/web_static/dance_library.json")
LIBRARY_GITHUB_TOKEN_ENV = "DANCE_LIBRARY_GITHUB_TOKEN"
DEFAULT_ALLOWED_ORIGINS = "https://xuzhidong-netizen.github.io,http://127.0.0.1:8000,http://localhost:8000"
KNOWN_LIBRARY_DANCES = {
    "伦巴", "平四", "吉特巴",
    "慢四", "慢三", "并四", "快三", "中三", "中四",
    "华尔兹", "探戈", "维也纳", "狐步", "快步", "国标伦巴", "国标恰恰", "桑巴", "牛仔", "斗牛", "阿根廷探戈",
    "青春16步", "花火16步", "32步", "64步", "兔子舞", "集体恰恰", "阿拉伯之夜", "马卡琳娜", "玛卡琳娜", "蒙古舞",
    "开场曲", "结束曲",
}


class AppState:
    def __init__(self) -> None:
        self.dance_list = dance_list_from_dict({"date": default_date_string(), "parts": []})


STATE = AppState()


async def json_body(request: Request) -> dict:
    return json.loads(await request.body() or b"{}")


def normalize_dance_label(value: str) -> str:
    text = str(value or "").strip()
    if text in {"十八摸", "马卡琳娜"}:
        return "玛卡琳娜"
    if "16步脱掉" in text or "脱掉16步" in text:
        return "青春16步"
    if "维也纳华尔兹" in text:
        return "维也纳"
    if "16步" in text and "青春16步" not in text and "花火16步" not in text:
        return text.replace("16步", "花火16步")
    return text


def clean_song_title(value: str) -> str:
    return re.sub(r"[-_\s]*点播$", "", str(value or "").strip())


def normalize_search_text(value: str) -> str:
    text = str(value or "").lower()
    text = re.sub(r"\.[^.]+$", "", text)
    return re.sub(r"[\s_\-()（）【】\[\]{}<>《》·,，.!！？?、:;\"'`~]+", "", text)


def library_default_data() -> dict:
    return {
        "version": 1,
        "updated_at": "",
        "songs": [],
    }


def normalize_library_payload(payload: dict | None) -> dict:
    songs = payload.get("songs") if isinstance(payload, dict) else []
    deduped: dict[str, dict] = {}
    for song in songs or []:
        title = clean_song_title(song.get("title"))
        dance = normalize_dance_label(song.get("dance"))
        if not title or not dance or dance not in KNOWN_LIBRARY_DANCES:
            continue
        normalized = {
            "title": title,
            "dance": dance,
            "updated_at": str(song.get("updated_at") or ""),
        }
        key = f"{normalize_search_text(title)}::{dance}"
        previous = deduped.get(key)
        if not previous or previous.get("updated_at", "") < normalized["updated_at"]:
            deduped[key] = normalized
    normalized_songs = sorted(
        deduped.values(),
        key=lambda item: (
            str(item.get("updated_at") or ""),
            item.get("title") or "",
            item.get("dance") or "",
        ),
        reverse=True,
    )
    return {
        "version": 1,
        "updated_at": str((payload or {}).get("updated_at") or ""),
        "songs": normalized_songs,
    }


def read_library_data() -> dict:
    if not LIBRARY_PATH.exists():
        return library_default_data()
    try:
        return normalize_library_payload(json.loads(LIBRARY_PATH.read_text(encoding="utf-8")))
    except Exception:
        return library_default_data()


def write_library_data(data: dict) -> None:
    LIBRARY_PATH.write_text(f"{json.dumps(normalize_library_payload(data), ensure_ascii=False, indent=2)}\n", encoding="utf-8")


def library_allowed_origins() -> list[str]:
    configured = os.getenv("DANCE_LIBRARY_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


def github_contents_url() -> str:
    encoded_path = "/".join(quote(segment, safe="") for segment in LIBRARY_GITHUB_PATH.split("/"))
    return f"https://api.github.com/repos/{LIBRARY_GITHUB_OWNER}/{LIBRARY_GITHUB_REPO}/contents/{encoded_path}"


def github_headers() -> dict[str, str]:
    token = os.getenv(LIBRARY_GITHUB_TOKEN_ENV, "").strip()
    if not token:
        raise RuntimeError(f"服务端未配置 {LIBRARY_GITHUB_TOKEN_ENV}，不能自动同步 GitHub。")
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dance-library-sync",
    }


def github_request(method: str, url: str, payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = github_headers()
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = UrlRequest(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        try:
            error_data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            error_data = {}
        raise RuntimeError(error_data.get("message") or f"GitHub API 请求失败：{exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"连接 GitHub 失败：{exc.reason}") from exc


def sync_library_data_to_github(data: dict) -> str:
    contents_url = github_contents_url()
    sha = None
    try:
        current = github_request("GET", f"{contents_url}?ref={quote(LIBRARY_GITHUB_BRANCH, safe='')}")
        sha = current.get("sha")
    except RuntimeError as exc:
        if "404" not in str(exc) and "Not Found" not in str(exc):
            raise

    normalized = normalize_library_payload(data)
    payload = {
        "message": f"update dance library {normalized.get('updated_at') or default_date_string()}",
        "content": base64.b64encode(f"{json.dumps(normalized, ensure_ascii=False, indent=2)}\n".encode("utf-8")).decode("ascii"),
        "branch": LIBRARY_GITHUB_BRANCH,
    }
    if sha:
        payload["sha"] = sha
    response = github_request("PUT", contents_url, payload)
    return response.get("commit", {}).get("html_url", "")


async def home(_: Request) -> HTMLResponse:
    html = (PACKAGE_ROOT / "standalone.html").read_text(encoding="utf-8")
    html = (
        html
        .replace("./web_static/示范舞曲-top3.zip", "/static/示范舞曲-top3.zip")
        .replace("./cloud_sample.json", "/static/cloud_sample.json")
        .replace("./cloud_full.json", "/static/cloud_full.json")
    )
    return HTMLResponse(html)


async def get_state(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True, "dance_list": dance_list_to_dict(STATE.dance_list)})


async def load_directory(request: Request) -> JSONResponse:
    payload = await json_body(request)
    path = payload.get("path", "").strip()
    if not path:
        return JSONResponse({"ok": False, "error": "缺少舞曲目录路径"}, status_code=400)
    try:
        dance_list = scan_music_directory(path)
        meta = payload.get("meta") or {}
        dance_list.title = meta.get("title") or dance_list.title
        dance_list.name = meta.get("name") or dance_list.name
        dance_list.date = meta.get("date") or default_date_string()
        dance_list.club = meta.get("club") or dance_list.club
        dance_list.place = meta.get("place") or dance_list.place
        dance_list.time = list(meta.get("time") or [])
        STATE.dance_list = dance_list
        return JSONResponse({"ok": True, "dance_list": dance_list_to_dict(dance_list)})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)


async def update_state(request: Request) -> JSONResponse:
    payload = await json_body(request)
    try:
        STATE.dance_list = dance_list_from_dict(payload.get("dance_list") or {})
        return JSONResponse({"ok": True, "dance_list": dance_list_to_dict(STATE.dance_list)})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)


async def check_rules(request: Request) -> JSONResponse:
    payload = await json_body(request)
    try:
        STATE.dance_list = dance_list_from_dict(payload.get("dance_list") or {})
        issues = [asdict(issue) for issue in validate_dance_list(STATE.dance_list)]
        return JSONResponse({"ok": True, "dance_list": dance_list_to_dict(STATE.dance_list), "issues": issues})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)


async def export_outputs(request: Request) -> JSONResponse:
    payload = await json_body(request)
    output_dir = Path(payload.get("output_dir") or ".")
    try:
        from dance_generator_rebuilt.services.exporter import export_html, export_pdf_and_png, export_txt

        STATE.dance_list = dance_list_from_dict(payload.get("dance_list") or {})
        html_path = export_html(STATE.dance_list, output_dir)
        txt_path = export_txt(STATE.dance_list, output_dir)
        pdf_path, png_path = export_pdf_and_png(html_path, STATE.dance_list, output_dir / "song-list")
        return JSONResponse(
            {
                "ok": True,
                "dance_list": dance_list_to_dict(STATE.dance_list),
                "files": {
                    "html": str(html_path),
                    "txt": str(txt_path),
                    "pdf": str(pdf_path),
                    "png": str(png_path),
                    "preview_url": f"/api/file?path={png_path.as_posix()}",
                },
            }
        )
    except ImportError as exc:
        return JSONResponse({"ok": False, "error": f"导出依赖缺失：{exc.name or exc}"}, status_code=503)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)


async def save_files(request: Request) -> JSONResponse:
    payload = await json_body(request)
    method = payload.get("method") or "copy"
    destination = payload.get("destination")
    try:
        from dance_generator_rebuilt.services.file_manager import save_music_files

        STATE.dance_list = dance_list_from_dict(payload.get("dance_list") or {})
        if not destination:
            compact_date = STATE.dance_list.date.replace("年", "").replace("月", "").replace("日", "")
            destination = str(WORKSPACE_ROOT / f"{compact_date} {STATE.dance_list.title}by{STATE.dance_list.name}")
        STATE.dance_list = save_music_files(STATE.dance_list, destination, method)
        return JSONResponse({"ok": True, "dance_list": dance_list_to_dict(STATE.dance_list), "destination": destination})
    except ImportError as exc:
        return JSONResponse({"ok": False, "error": f"保存依赖缺失：{exc.name or exc}"}, status_code=503)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)


async def add_song(request: Request) -> JSONResponse:
    payload = await json_body(request)
    try:
        STATE.dance_list = dance_list_from_dict(payload.get("dance_list") or {})
        file_path = payload.get("file_path", "").strip()
        if not file_path:
            return JSONResponse({"ok": False, "error": "缺少舞曲文件路径"}, status_code=400)
        song = parse_song(Path(file_path))
        if not STATE.dance_list.parts:
            STATE.dance_list.parts = [Part(part_title=None)]
        STATE.dance_list.parts[-1].music.append(song)
        STATE.dance_list = dance_list_from_dict(dance_list_to_dict(STATE.dance_list))
        return JSONResponse({"ok": True, "dance_list": dance_list_to_dict(STATE.dance_list)})
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)


async def serve_file(request: Request) -> Response:
    file_path = request.query_params.get("path", "")
    if not file_path:
        return Response(status_code=404)
    path = Path(unquote(file_path))
    if not path.exists() or not path.is_file():
        return Response(status_code=404)
    return FileResponse(path)


async def get_library(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True, "data": read_library_data(), "source": "backend"})


async def save_library(request: Request) -> JSONResponse:
    payload = await json_body(request)
    try:
        data = normalize_library_payload(payload.get("data") or {})
        if not data.get("songs"):
            return JSONResponse({"ok": False, "error": "舞曲库没有可保存的数据。"}, status_code=400)
        commit_url = sync_library_data_to_github(data)
        write_library_data(data)
        return JSONResponse({"ok": True, "data": data, "commit_url": commit_url, "source": "backend"})
    except Exception as exc:
        status_code = 503 if LIBRARY_GITHUB_TOKEN_ENV in str(exc) else 500
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=status_code)


def create_app() -> Starlette:
    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=library_allowed_origins(),
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["*"],
        )
    ]
    routes = [
        Route("/", home),
        Route("/standalone.html", home),
        Route("/api/state", get_state, methods=["GET"]),
        Route("/api/load", load_directory, methods=["POST"]),
        Route("/api/update", update_state, methods=["POST"]),
        Route("/api/check", check_rules, methods=["POST"]),
        Route("/api/export", export_outputs, methods=["POST"]),
        Route("/api/save", save_files, methods=["POST"]),
        Route("/api/add-song", add_song, methods=["POST"]),
        Route("/api/library", get_library, methods=["GET"]),
        Route("/api/library", save_library, methods=["POST"]),
        Route("/api/file", serve_file, methods=["GET"]),
        Mount("/static", app=StaticFiles(directory=STATIC_ROOT), name="static"),
        Mount("/web_static", app=StaticFiles(directory=STATIC_ROOT), name="web_static"),
    ]
    return Starlette(routes=routes, middleware=middleware)


app = create_app()


def main() -> int:
    uvicorn.run("dance_generator_rebuilt.web:app", host="127.0.0.1", port=8000, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
