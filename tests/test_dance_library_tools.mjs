import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../dance_generator_rebuilt/web_static/dance_library_tools.js", import.meta.url),
  "utf8",
);

function loadTools() {
  const storage = new Map();
  const context = {
    console,
    URL,
    AbortController,
    TextEncoder,
    TextDecoder,
    location: {
      href: "https://xuzhidong-netizen.github.io/3.py/dance_generator_rebuilt/web_static/library.html",
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    open() {
      return {};
    },
    setTimeout,
    clearTimeout,
    fetch: async () => {
      throw new Error("fetch should be mocked explicitly in this test");
    },
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
    btoa(value) {
      return Buffer.from(value, "binary").toString("base64");
    },
    BroadcastChannel: class {
      postMessage() {}
      close() {}
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.DanceLibraryTools;
}

test("parseSongFileName strips choose suffix and extracts dance", () => {
  const tools = loadTools();

  const parsed = tools.parseSongFileName("03-并四-月亮惹的祸-点播.mp3");

  assert.equal(parsed.dance, "并四");
  assert.equal(parsed.title, "月亮惹的祸");
});

test("mergeLibraryEntries counts added updated and skipped rows", () => {
  const tools = loadTools();
  const base = {
    version: 1,
    updated_at: "2026-03-03T10:00:00Z",
    songs: [{ title: "月亮惹的祸", dance: "并四", updated_at: "2026-03-03T10:00:00Z" }],
  };

  const result = tools.mergeLibraryEntries(base, [
    { title: "月亮惹的祸", dance: "并四" },
    { title: "夜来香", dance: "伦巴" },
    { title: "", dance: "" },
  ]);

  assert.equal(result.updated, 1);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.data.songs.length, 2);
});

test("resolveDanceFromLibrary returns ambiguous for multi-dance titles", () => {
  const tools = loadTools();
  const data = {
    version: 1,
    updated_at: "2026-03-03T10:00:00Z",
    songs: [
      { title: "同名歌曲", dance: "并四", updated_at: "2026-03-03T10:00:00Z" },
      { title: "同名歌曲", dance: "伦巴", updated_at: "2026-03-03T10:00:01Z" },
    ],
  };

  const resolved = tools.resolveDanceFromLibrary(data, "同名歌曲.mp3");

  assert.equal(resolved.dance, "");
  assert.equal(resolved.ambiguous, true);
});

test("queryLibrarySongs ranks exact title matches before fuzzy matches", () => {
  const tools = loadTools();
  const data = {
    version: 1,
    updated_at: "2026-03-03T10:00:00Z",
    songs: [
      { title: "月亮惹的祸", dance: "并四", updated_at: "2026-03-03T10:00:00Z" },
      { title: "月亮惹的祸慢版", dance: "慢四", updated_at: "2026-03-03T10:00:00Z" },
    ],
  };

  const matches = tools.queryLibrarySongs(data, "月亮惹的祸");

  assert.equal(matches[0].title, "月亮惹的祸");
  assert.equal(matches[0].score > matches[1].score, true);
});
