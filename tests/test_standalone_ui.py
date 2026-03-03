from __future__ import annotations

import contextlib
import http.server
import socketserver
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright


STATIC_ROOT = Path("/Volumes/Extreme SSD/舞曲生成器/songlist_gen2 3/dance_generator_rebuilt")
CHROME_PATH = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


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


def test_delete_all_clears_loaded_songs(browser, static_server):
    page = browser.new_page()
    try:
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


def test_import_clear_buttons_reset_picker_values(browser, static_server):
    page = browser.new_page()
    try:
        page.goto(f"{static_server}/standalone.html")
        assert page.locator("#loadCloudBtn").inner_text() == "加载云端前3首示例"
        assert page.locator("#downloadCloudBtn").inner_text() == "下载前3首示例舞曲"
        assert page.locator("#loadCloudFullBtn").inner_text() == "加载云端全部示范舞曲"
        assert page.locator("#downloadCloudFullBtn").inner_text() == "下载全部示范舞曲"
        page.evaluate(
            """
            () => {
              const fileInput = document.getElementById('fileInput');
              const archiveInput = document.getElementById('archiveInput');
              Object.defineProperty(fileInput, 'value', { configurable: true, writable: true, value: 'mock-directory' });
              Object.defineProperty(archiveInput, 'value', { configurable: true, writable: true, value: 'mock-archive' });
            }
            """
        )

        page.locator("#clearFileInputBtn").click()
        page.locator("#clearArchiveInputBtn").click()

        assert page.locator("#fileInput").evaluate("element => element.value") == ""
        assert page.locator("#archiveInput").evaluate("element => element.value") == ""
    finally:
        page.close()


def test_library_and_recognizer_pages_render_core_controls(browser, static_server):
    pages = [
        (f"{static_server}/web_static/library.html", "#groupFilter"),
        (f"{static_server}/web_static/recognizer.html", "#searchInput"),
    ]
    for url, selector in pages:
        page = browser.new_page()
        try:
            page.goto(url)
            page.wait_for_selector(selector)
            assert page.locator("text=返回主页面").count() >= 1
        finally:
            with contextlib.suppress(Exception):
                page.close()
