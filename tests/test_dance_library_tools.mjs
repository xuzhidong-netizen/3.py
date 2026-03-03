import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../dance_generator_rebuilt/web_static/dance_library_tools.js", import.meta.url),
  "utf8",
);

function loadTools(overrides = {}) {
  const storage = new Map();
  const defaultLocation = {
    href: "https://xuzhidong-netizen.github.io/3.py/dance_generator_rebuilt/web_static/library.html",
  };
  const defaultStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  const context = {
    console,
    URL,
    AbortController,
    TextEncoder,
    TextDecoder,
    location: defaultLocation,
    localStorage: defaultStorage,
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
    ...overrides,
  };
  context.location = { ...defaultLocation, ...(overrides.location || {}) };
  context.localStorage = overrides.localStorage || defaultStorage;
  context.window = context;
  vm.runInNewContext(source, context);
  return context.DanceLibraryTools;
}

function mockJsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] ?? headers[name] ?? "";
      },
    },
    json: async () => payload,
  };
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

test("loadLibraryData prefers backend api when current page runs on backend server", async () => {
  const tools = loadTools({
    location: {
      href: "http://127.0.0.1:8000/web_static/library.html",
    },
    fetch: async (url) => {
      assert.equal(url.startsWith("http://127.0.0.1:8000/api/library"), true);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          source: "backend",
          data: {
            version: 1,
            updated_at: "2026-03-03T10:00:00Z",
            songs: [{ title: "夜来香", dance: "伦巴", updated_at: "2026-03-03T10:00:00Z" }],
          },
        }),
      };
    },
  });

  const result = await tools.loadLibraryData();

  assert.equal(result.source, "backend");
  assert.equal(result.data.songs[0].title, "夜来香");
});

test("saveLibraryData uses backend api before browser token fallback", async () => {
  const tools = loadTools({
    location: {
      href: "http://127.0.0.1:8000/web_static/library.html",
    },
    fetch: async (url, options = {}) => {
      assert.equal(url, "http://127.0.0.1:8000/api/library");
      assert.equal(options.method, "POST");
      return {
        ok: true,
        json: async () => ({
          ok: true,
          source: "backend",
          commit_url: "https://example.com/commit/1",
          data: {
            version: 1,
            updated_at: "2026-03-03T10:00:00Z",
            songs: [{ title: "夜来香", dance: "伦巴", updated_at: "2026-03-03T10:00:00Z" }],
          },
        }),
      };
    },
  });

  const result = await tools.saveLibraryData({
    version: 1,
    updated_at: "2026-03-03T10:00:00Z",
    songs: [{ title: "夜来香", dance: "伦巴", updated_at: "2026-03-03T10:00:00Z" }],
  });

  assert.equal(result.source, "backend");
  assert.equal(result.commitUrl, "https://example.com/commit/1");
});

test("probeBackendAvailability reports backend health when api is reachable", async () => {
  const tools = loadTools({
    location: {
      href: "http://127.0.0.1:8000/web_static/library.html",
    },
    fetch: async (url) => {
      assert.equal(url.startsWith("http://127.0.0.1:8000/api/library"), true);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            version: 1,
            updated_at: "2026-03-03T10:00:00Z",
            songs: [{ title: "夜来香", dance: "伦巴", updated_at: "2026-03-03T10:00:00Z" }],
          },
        }),
      };
    },
  });

  const result = await tools.probeBackendAvailability();

  assert.equal(result.ok, true);
  assert.equal(result.data.songs[0].title, "夜来香");
});

test("probeBackendAvailability reports failure when static page has no backend", async () => {
  const tools = loadTools({
    location: {
      href: "https://xuzhidong-netizen.github.io/3.py/dance_generator_rebuilt/standalone.html",
    },
    fetch: async (url) => {
      assert.equal(url.startsWith("https://xuzhidong-netizen.github.io/api/library"), true);
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: "Not Found",
        }),
      };
    },
  });

  const result = await tools.probeBackendAvailability();

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("saveLibraryData surfaces friendly message for token permission errors", async () => {
  const storage = new Map();
  let step = 0;
  const tools = loadTools({
    location: {
      href: "file:///tmp/library.html",
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
    fetch: async (url, options = {}) => {
      step += 1;
      if (step === 1) {
        return mockJsonResponse(200, {
          sha: "sha-1",
          content: Buffer.from(JSON.stringify({
            version: 1,
            updated_at: "2026-03-03T10:00:00Z",
            songs: [],
          })).toString("base64"),
        });
      }
      if (step === 2) {
        return mockJsonResponse(403, {
          message: "Resource not accessible by personal access token",
        });
      }
      if (url === "https://api.github.com/repos/xuzhidong-netizen/3.py") {
        return mockJsonResponse(200, {
          permissions: { push: true },
        });
      }
      return mockJsonResponse(200, {
        sha: "sha-1",
        content: Buffer.from(JSON.stringify({
          version: 1,
          updated_at: "2026-03-03T10:00:00Z",
          songs: [],
        })).toString("base64"),
      });
    },
  });
  tools.setGitHubToken("github_pat_test");

  await assert.rejects(
    () => tools.saveLibraryData({
      version: 1,
      updated_at: "2026-03-03T10:00:00Z",
      songs: [{ title: "夜来香", dance: "伦巴", updated_at: "2026-03-03T10:00:00Z" }],
    }),
    /Contents: Read only/,
  );
});

test("inspectGitHubToken reports repo selection issues clearly", async () => {
  const tools = loadTools({
    fetch: async (url) => {
      assert.equal(url, "https://api.github.com/repos/xuzhidong-netizen/3.py");
      return mockJsonResponse(404, {
        message: "Not Found",
      });
    },
  });

  const result = await tools.inspectGitHubToken("github_pat_test");

  assert.equal(result.ok, false);
  assert.equal(result.code, "repo_not_selected");
  assert.match(result.message, /看不到仓库 xuzhidong-netizen\/3\.py/);
});

test("inspectGitHubToken reports classic token repo scope problems", async () => {
  const tools = loadTools({
    fetch: async (url) => {
      if (url === "https://api.github.com/repos/xuzhidong-netizen/3.py") {
        return mockJsonResponse(200, {
          permissions: { push: true },
        }, {
          "x-oauth-scopes": "read:user, user:email",
        });
      }
      return mockJsonResponse(200, {
        sha: "sha-1",
        content: Buffer.from(JSON.stringify({
          version: 1,
          updated_at: "2026-03-03T10:00:00Z",
          songs: [],
        })).toString("base64"),
      });
    },
  });

  const result = await tools.inspectGitHubToken("ghp_test");

  assert.equal(result.ok, false);
  assert.equal(result.code, "classic_scope_missing");
  assert.match(result.message, /缺少 repo scope/);
});
