from __future__ import annotations

import contextlib
import http.server
import socketserver
import threading
import shutil
from pathlib import Path
import json

import pytest
from playwright.sync_api import sync_playwright


STATIC_ROOT = Path("/Volumes/Extreme SSD/舞曲生成器/songlist_gen2 3/dance_generator_rebuilt")
CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
TOP3_ZIP_PATH = STATIC_ROOT / "web_static" / "示范舞曲-top3.zip"


def stub_cloud_top3(page) -> None:
    zip_bytes = TOP3_ZIP_PATH.read_bytes()
    page.route(
        "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/cloud_sample.json",
        lambda route: route.fulfill(
            status=200,
            headers={
                "content-type": "application/json; charset=utf-8",
                "access-control-allow-origin": "*",
            },
            body=json.dumps(
                {
                    "version": 1,
                    "title": "示例歌单",
                    "download_url": "./web_static/示范舞曲-top3.zip",
                    "tracks": [],
                },
                ensure_ascii=False,
            ),
        ),
    )
    page.route(
        "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/web_static/%E7%A4%BA%E8%8C%83%E8%88%9E%E6%9B%B2-top3.zip",
        lambda route: route.fulfill(
            status=200,
            headers={
                "content-type": "application/zip",
                "access-control-allow-origin": "*",
            },
            body=zip_bytes,
        ),
    )


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


@pytest.fixture(scope="module")
def static_server():
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(STATIC_ROOT), **kwargs)
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{port}"
        finally:
            httpd.shutdown()
            thread.join()


@pytest.fixture(scope="module")
def browser():
    if not CHROME_PATH.exists():
        pytest.skip("Google Chrome is not installed in /Applications")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=str(CHROME_PATH), headless=True)
        try:
            yield browser
        finally:
            browser.close()


@pytest.fixture(scope="module")
def import_dirs(tmp_path_factory):
    root = tmp_path_factory.mktemp("dance-imports")
    small_dir = root / "small"
    large_dir = root / "large"
    small_dir.mkdir()
    large_dir.mkdir()

    sample_names = [
        "001-慢四-测试舞曲1.mp3",
        "002-吉特巴-测试舞曲2.mp3",
        "003-并四-测试舞曲3.mp3",
        "004-平四-测试舞曲4.mp3",
        "005-慢三-测试舞曲5.mp3",
        "006-伦巴-测试舞曲6.mp3",
        "007-快三-测试舞曲7.mp3",
        "008-兔子舞-测试舞曲8.mp3",
    ]

    for index in range(24):
        (small_dir / sample_names[index % len(sample_names)].replace("测试舞曲", f"小批量舞曲{index + 1}-")).write_bytes(b"")

    for index in range(160):
        (large_dir / sample_names[index % len(sample_names)].replace("测试舞曲", f"大批量舞曲{index + 1}-")).write_bytes(b"")

    try:
        yield {"small": small_dir, "large": large_dir}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_delete_all_clears_loaded_songs(browser, static_server):
    page = browser.new_page()
    try:
        stub_cloud_top3(page)
        page.goto(f"{static_server}/standalone.html")
        page.locator("#loadCloudBtn").click()
        page.wait_for_function("document.querySelectorAll('#songsBody .song-row').length > 0")

        assert page.locator("#countStat").inner_text() == "3"
        assert page.locator("#songsBody .song-row").count() == 3

        page.locator("#deleteAllSongsBtn").click()
        page.wait_for_timeout(300)

        assert page.locator("#countStat").inner_text() == "0"
        assert page.locator("#songsBody .song-row").count() == 0
        assert page.locator("#issueCount").inner_text() == "0"
        logs = page.locator("#log .log-entry")
        assert any("已全部删除当前舞曲表" in logs.nth(index).inner_text() for index in range(logs.count()))
    finally:
        page.close()


def test_cloud_sample_load_resolves_playlist_relative_archive_url(browser, static_server):
    page = browser.new_page()
    try:
        stub_cloud_top3(page)
        page.goto(f"{static_server}/standalone.html")
        page.locator("#loadCloudBtn").click()
        page.wait_for_function("document.querySelectorAll('#songsBody .song-row').length > 0")

        assert page.locator("#countStat").inner_text() == "3"
        assert page.locator("#songsBody .song-row").count() == 3
    finally:
        page.close()


def test_cloud_sample_load_retries_remote_archive(browser, static_server):
    page = browser.new_page()
    try:
        zip_bytes = TOP3_ZIP_PATH.read_bytes()
        attempts = {"zip": 0}

        page.route(
            "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/cloud_sample.json",
            lambda route: route.fulfill(
                status=200,
                headers={
                    "content-type": "application/json; charset=utf-8",
                    "access-control-allow-origin": "*",
                },
                body=json.dumps(
                    {
                        "version": 1,
                        "title": "示例歌单",
                        "download_url": "./web_static/示范舞曲-top3.zip",
                        "tracks": [],
                    },
                    ensure_ascii=False,
                ),
            ),
        )

        def handle_zip(route):
            attempts["zip"] += 1
            if attempts["zip"] == 1:
                route.fulfill(status=503, body="retry later")
                return
            route.fulfill(
                status=200,
                headers={
                    "content-type": "application/zip",
                    "access-control-allow-origin": "*",
                },
                body=zip_bytes,
            )

        page.route(
            "https://xuzhidong-netizen.github.io/2.py/dance_generator_rebuilt/web_static/%E7%A4%BA%E8%8C%83%E8%88%9E%E6%9B%B2-top3.zip",
            handle_zip,
        )
        page.goto(f"{static_server}/standalone.html")
        page.locator("#loadCloudBtn").click()
        page.wait_for_function("document.querySelectorAll('#songsBody .song-row').length > 0")

        assert attempts["zip"] == 2
        assert page.locator("#countStat").inner_text() == "3"
        assert page.locator("#log .log-entry").first.inner_text().startswith("已从压缩包导入前3首示范舞曲")
    finally:
        page.close()


def test_cloud_full_load_uses_same_origin_assets_without_fetch_failure(browser, static_server):
    page = browser.new_page()
    try:
        page.goto(f"{static_server}/standalone.html")
        page.locator("#loadCloudFullBtn").click()
        page.wait_for_function("document.querySelectorAll('#songsBody .song-row').length > 0", timeout=60000)

        assert page.locator("#countStat").inner_text() == "49"
        assert page.locator("#songsBody .song-row").count() == 20
        assert "第 1 / 3 页" in page.locator("#songsPagination").inner_text()
        log_entries = page.locator("#log .log-entry")
        assert any("已导入云端全部示范舞曲 49 首" in log_entries.nth(index).inner_text() for index in range(log_entries.count()))
        assert not any("Failed to fetch" in log_entries.nth(index).inner_text() for index in range(log_entries.count()))
    finally:
        page.close()


def test_cloud_full_download_prefers_prebuilt_release_zip() -> None:
    html = (STATIC_ROOT / "standalone.html").read_text(encoding="utf-8")

    assert 'const CLOUD_FULL_RELEASE_ZIP_URL = "https://github.com/xuzhidong-netizen/3.py/releases/download/v1.24-assets/1.24.zip";' in html
    assert 'triggerDownload(CLOUD_FULL_RELEASE_ZIP_URL, CLOUD_FULL_ARCHIVE_NAME);' in html


def test_zip_import_loads_local_archive(browser, static_server):
    page = browser.new_page()
    try:
        page.goto(f"{static_server}/standalone.html")
        page.locator("#archiveInput").set_input_files(str(TOP3_ZIP_PATH))
        page.wait_for_function("document.querySelector('#countStat') && document.querySelector('#countStat').textContent === '3'")

        assert page.locator("#songsBody .song-row").count() == 3
        logs = page.locator("#log .log-entry")
        assert any("已在浏览器中解压 示范舞曲-top3.zip，得到 3 首舞曲" in logs.nth(index).inner_text() for index in range(logs.count()))
        assert any("已读取 3 首舞曲" in logs.nth(index).inner_text() for index in range(logs.count()))
    finally:
        page.close()


def test_zip_import_finishes_with_simple_flow(browser, static_server):
    page = browser.new_page()
    try:
        page.goto(f"{static_server}/standalone.html")
        page.locator("#archiveInput").set_input_files(str(TOP3_ZIP_PATH))
        page.wait_for_function("document.querySelector('#countStat') && document.querySelector('#countStat').textContent === '3'", timeout=60000)

        assert page.locator("#songsBody .song-row").count() == 3
        logs = page.locator("#log .log-entry")
        texts = [logs.nth(index).inner_text() for index in range(logs.count())]
        assert any("已选择ZIP 压缩包，开始自动读取舞曲" in text for text in texts)
        assert any("已读取 3 首舞曲" in text for text in texts)
        assert any("读取舞曲进度 95% · 正在写入舞曲表 3 首" in text for text in texts)
        assert not any("已启用大批量快速模式" in text for text in texts)
        assert not any("舞曲库同步将在后台继续" in text for text in texts)
    finally:
        page.close()


def test_zip_import_only_flow() -> None:
    html = (STATIC_ROOT / "standalone.html").read_text(encoding="utf-8")

    assert "async function loadFiles()" in html
    assert "async function yieldToBrowser()" in html
    assert "已选择 ZIP ${archiveFiles.length} 个" in html
    assert "正在解析舞曲 ${i + 1}/${files.length} · ${currentName}" in html
    assert "if ((i + 1) % 5 === 0) {" in html
    assert "await syncSongsToDanceLibrary(\"读取文件\")" in html
    assert "async function extractArchiveFiles(archiveFiles, progress = null)" in html
    assert "if ((entryIndex + 1) % 10 === 0) {" in html
    assert "fileInput" not in html
    assert "function createTaskGuard(label, progress = null, options = {})" not in html
    assert "function createImportRestartError(message = \"导入任务已由保护机制自动重启\")" not in html
    assert "function ensureImportRunActive(runId)" not in html
    assert "function summarizeImportSelection(files)" not in html
    assert "async function importDirectoryFiles(files, progress = null, parseOptions = {}, guard = null, runId = 0)" not in html
    assert "舞曲库同步将在后台继续" not in html


def test_song_table_has_pagination_controls() -> None:
    html = (STATIC_ROOT / "standalone.html").read_text(encoding="utf-8")

    assert 'id="songsPageSize"' in html
    assert 'value="20">20 首' in html
    assert 'value="50">50 首' in html
    assert 'value="100">100 首' in html
    assert 'id="songsPagination"' in html


def test_stage_page_has_paginated_scroll_layout() -> None:
    html = (STATIC_ROOT / "standalone.html").read_text(encoding="utf-8")

    assert "data-stage-page-size" in html
    assert "stage-board-scroll" in html
    assert "focusCurrentStageSong" in html
    assert "STAGE_PAGE_SIZE_OPTIONS = [20, 50, 100]" in html
    assert '{ id: "sapphire", label: "蓝调星幕", note: "深海霓光" }' in html
    assert '{ id: "sunrise", label: "晨曦云幕", note: "日出粉橙" }' in html
    assert "stage-controls" in html
    assert "stage-summary" in html
    assert "stage-now " in html


def test_import_cards_use_compact_layout_without_clear_buttons(browser, static_server):
    page = browser.new_page()
    try:
        page.goto(f"{static_server}/standalone.html")
        assert page.locator("#loadCloudBtn").inner_text() == "加载云端前3首示例"
        assert page.locator("#downloadCloudBtn").inner_text() == "下载前3首示例舞曲"
        assert page.locator("#loadCloudFullBtn").inner_text() == "加载云端全部示范舞曲"
        assert page.locator("#downloadCloudFullBtn").inner_text() == "下载全部示范舞曲"
        assert page.locator("#archiveInput").count() == 1
        assert page.locator("text=导入舞曲文件").count() == 0
        assert page.locator("text=导入舞曲目录").count() == 0
        assert page.locator("text=导入 ZIP 压缩包").count() == 1
        assert page.locator("#clearFileInputBtn").count() == 0
        assert page.locator("#clearArchiveInputBtn").count() == 0
        html = page.content()
        assert "webkitdirectory" not in html
    finally:
        page.close()


def test_static_page_shows_fallback_protection_controls(browser, static_server):
    page = browser.new_page()
    try:
        page.goto(f"{static_server}/standalone.html")
        page.wait_for_function(
            """
            () => {
              const badge = document.querySelector('#fallbackModeBadge');
              const status = document.querySelector('#fallbackStatus');
              return badge && status && /后端优先|静态兜底|等待令牌/.test(badge.textContent) && /本机服务|静态兜底|GitHub Token/.test(status.textContent);
            }
            """,
            timeout=30000,
        )

        assert page.locator("#saveFallbackTokenBtn").count() == 1
        assert page.locator("#clearFallbackTokenBtn").count() == 1
        assert page.locator("#loginFallbackGitHubBtn").count() == 1
        assert page.locator("#openStaticFallbackBtn").count() == 1
        html = page.content()
        assert "import_pending" in html
        assert "auto_save" in html
    finally:
        page.close()


def test_library_and_recognizer_pages_render_core_controls(browser, static_server):
    pages = [
        (f"{static_server}/web_static/library.html", "#groupFilter"),
        (f"{static_server}/web_static/recognizer.html", "#searchInput"),
        (f"{static_server}/web_static/full_sample_download.html", "#downloadZipBtn"),
    ]
    for url, selector in pages:
        page = browser.new_page()
        try:
            page.goto(url)
            page.wait_for_selector(selector)
            assert page.locator("text=返回主页面").count() >= 1
            if "library.html" in url:
                assert page.locator("#checkTokenBtn").count() == 1
                assert page.locator("#openBackendBtn").count() == 1
                html = page.content()
                assert "import_pending" in html
                assert "auto_save" in html
            if selector == "#downloadZipBtn":
                assert page.locator("#downloadAllBtn").count() == 1
        finally:
            with contextlib.suppress(Exception):
                page.close()
