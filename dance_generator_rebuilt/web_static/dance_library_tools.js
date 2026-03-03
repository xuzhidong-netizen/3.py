(function (global) {
  const HANDLE = ["伦巴", "平四", "吉特巴"];
  const FRAME = ["慢四", "慢三", "并四", "快三", "中三", "中四"];
  const BALLROOM = ["华尔兹", "探戈", "维也纳", "狐步", "快步", "国标伦巴", "国标恰恰", "桑巴", "牛仔", "斗牛", "阿根廷探戈"];
  const COLLECTIVE = ["青春16步", "花火16步", "32步", "64步", "兔子舞", "集体恰恰", "阿拉伯之夜", "马卡琳娜", "玛卡琳娜", "蒙古舞"];
  const KNOWN = new Set([...HANDLE, ...FRAME, ...BALLROOM, ...COLLECTIVE, "开场曲", "结束曲"]);
  const CACHE_KEY = "dance-library-cache-v1";
  const TOKEN_KEY = "dance-library-github-token-v1";
  const SYNC_CHANNEL = "dance-library-sync-v1";
  const GITHUB_LOGIN_URL = "https://github.com/login";
  const GITHUB_PAT_NEW_URL = "https://github.com/settings/personal-access-tokens/new";
  const GITHUB = {
    owner: "xuzhidong-netizen",
    repo: "3.py",
    branch: "main",
    path: "dance_generator_rebuilt/web_static/dance_library.json",
  };
  const CONTENTS_URL = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${GITHUB.path.split("/").map(encodeURIComponent).join("/")}`;
  const RAW_URL = `https://raw.githubusercontent.com/${GITHUB.owner}/${GITHUB.repo}/${GITHUB.branch}/${GITHUB.path}`;
  const GROUP_MAP = new Map([
    ...HANDLE.map((dance) => [dance, "拉手舞"]),
    ...FRAME.map((dance) => [dance, "架型舞"]),
    ...BALLROOM.map((dance) => [dance, "国标舞"]),
    ...COLLECTIVE.map((dance) => [dance, "集体舞"]),
  ]);

  function defaultLibraryData() {
    return {
      version: 1,
      updated_at: "",
      songs: [],
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cleanFileName(value) {
    return String(value ?? "")
      .replaceAll(" - ", "-")
      .replaceAll("- ", "-")
      .replaceAll(" -", "-")
      .replaceAll("（", "(")
      .replaceAll("）", ")")
      .replaceAll("(1)", "")
      .replaceAll("(2)", "")
      .trim();
  }

  function normalizeDanceLabel(label) {
    const text = String(label ?? "").trim();
    if (text === "十八摸" || text === "马卡琳娜") return "玛卡琳娜";
    if (text.includes("16步脱掉") || text.includes("脱掉16步")) return "青春16步";
    if (text.includes("维也纳华尔兹")) return "维也纳";
    if (text.includes("16步") && !text.includes("青春16步") && !text.includes("花火16步")) {
      return text.replace("16步", "花火16步");
    }
    return text;
  }

  function cleanSongTitle(value) {
    return String(value ?? "").replace(/[-_\s]*点播$/u, "").trim();
  }

  function normalizeSearchText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/[\s_\-()（）【】\[\]{}<>《》·,，.!！？?、:;"'`~]/g, "");
  }

  function parseSongFileName(fileName) {
    const cleanedName = cleanFileName(fileName);
    const stem = cleanedName.replace(/\.[^.]+$/, "");
    let raw = stem;
    if (stem.length >= 3 && /^\d{2}/.test(stem.slice(0, 2)) && stem[2] !== "步") {
      raw = stem.slice(3);
    }

    let dance = "";
    let title = raw;
    let other = "";
    const firstDash = raw.indexOf("-");
    if (firstDash !== -1) {
      const candidate = normalizeDanceLabel(raw.slice(0, firstDash));
      const normalizedRaw = normalizeDanceLabel(raw);
      if (KNOWN.has(candidate)) {
        dance = candidate;
        const remainder = normalizedRaw.slice(firstDash + 1);
        const secondDash = remainder.indexOf("-");
        if (secondDash === -1 || remainder.slice(secondDash + 1).indexOf("-") === -1) {
          title = remainder;
        } else {
          const thirdIndex = secondDash + 1 + remainder.slice(secondDash + 1).indexOf("-");
          title = remainder.slice(0, thirdIndex);
          other = remainder.slice(thirdIndex + 1);
        }
      }
    }

    title = cleanSongTitle(title);
    return {
      fileName,
      cleanedName,
      stem,
      raw,
      dance,
      title,
      other,
      titleKey: normalizeSearchText(title),
      rawKey: normalizeSearchText(raw),
    };
  }

  function classifyDanceGroup(dance) {
    return GROUP_MAP.get(normalizeDanceLabel(dance)) || "";
  }

  function entryKey(entry) {
    return `${normalizeSearchText(entry.title)}::${normalizeDanceLabel(entry.dance)}`;
  }

  function normalizeLibraryData(payload) {
    const songs = Array.isArray(payload?.songs) ? payload.songs : [];
    const deduped = new Map();

    songs.forEach((song) => {
      const title = cleanSongTitle(song?.title);
      const dance = normalizeDanceLabel(song?.dance);
      if (!title || !dance) return;
      const normalized = {
        title,
        dance,
        updated_at: String(song?.updated_at || ""),
      };
      const key = entryKey(normalized);
      const previous = deduped.get(key);
      if (!previous || previous.updated_at < normalized.updated_at) {
        deduped.set(key, normalized);
      }
    });

    return {
      version: 1,
      updated_at: String(payload?.updated_at || ""),
      songs: [...deduped.values()].sort((left, right) => {
        const updatedDiff = String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
        if (updatedDiff) return updatedDiff;
        const titleDiff = left.title.localeCompare(right.title, "zh-CN");
        if (titleDiff) return titleDiff;
        return left.dance.localeCompare(right.dance, "zh-CN");
      }),
    };
  }

  function readCachedLibraryData() {
    try {
      const cached = global.localStorage.getItem(CACHE_KEY);
      return cached ? normalizeLibraryData(JSON.parse(cached)) : defaultLibraryData();
    } catch (error) {
      return defaultLibraryData();
    }
  }

  function cacheLibraryData(data) {
    global.localStorage.setItem(CACHE_KEY, JSON.stringify(normalizeLibraryData(data)));
  }

  function getGitHubToken() {
    try {
      return global.localStorage.getItem(TOKEN_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function setGitHubToken(token) {
    global.localStorage.setItem(TOKEN_KEY, String(token ?? "").trim());
  }

  function clearGitHubToken() {
    global.localStorage.removeItem(TOKEN_KEY);
  }

  function openPopup(url, name) {
    return global.open(
      url,
      name || "github-auth",
      "popup=yes,width=980,height=760,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes"
    );
  }

  function openGitHubLoginWindow() {
    const returnTo = encodeURIComponent(GITHUB_PAT_NEW_URL);
    return openPopup(`${GITHUB_LOGIN_URL}?return_to=${returnTo}`, "github-login");
  }

  function openGitHubTokenWindow() {
    return openPopup(GITHUB_PAT_NEW_URL, "github-token");
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`读取失败：${response.status}`);
    }
    return response.json();
  }

  async function loadLibraryData() {
    const urls = [RAW_URL, new URL("./dance_library.json", global.location.href).toString()];
    let lastError = null;
    for (const url of [...new Set(urls)]) {
      try {
        const data = normalizeLibraryData(await fetchJson(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`));
        cacheLibraryData(data);
        return {
          data,
          source: url,
        };
      } catch (error) {
        lastError = error;
      }
    }
    return {
      data: readCachedLibraryData(),
      source: "cache",
      error: lastError ? lastError.message : "",
    };
  }

  function mergeLibraryEntries(currentData, additions) {
    const normalized = normalizeLibraryData(currentData);
    const map = new Map(normalized.songs.map((song) => [entryKey(song), song]));
    const timestamp = new Date().toISOString();
    let added = 0;
    let updated = 0;
    let skipped = 0;

    additions.forEach((item) => {
      const title = cleanSongTitle(item?.title);
      const dance = normalizeDanceLabel(item?.dance);
      if (!title || !dance) {
        skipped += 1;
        return;
      }
      const nextSong = { title, dance, updated_at: timestamp };
      const key = entryKey(nextSong);
      if (map.has(key)) updated += 1;
      else added += 1;
      map.set(key, nextSong);
    });

    return {
      data: normalizeLibraryData({
        version: 1,
        updated_at: timestamp,
        songs: [...map.values()],
      }),
      added,
      updated,
      skipped,
    };
  }

  function queryLibrarySongs(data, query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [];
    return normalizeLibraryData(data).songs
      .map((song) => {
        const titleKey = normalizeSearchText(song.title);
        let score = 0;
        if (titleKey === normalizedQuery) score = 400;
        else if (titleKey.startsWith(normalizedQuery) || normalizedQuery.startsWith(titleKey)) score = 300;
        else if (titleKey.includes(normalizedQuery) || normalizedQuery.includes(titleKey)) score = 200;
        if (!score) return null;
        return { ...song, score };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.title.length - right.title.length;
      });
  }

  function resolveMatches(matches, mode) {
    const dances = [...new Set(matches.map((item) => item.dance))];
    if (dances.length === 1) {
      return {
        dance: dances[0],
        match: matches[0],
        matches,
        ambiguous: false,
        mode,
      };
    }
    return {
      dance: "",
      match: null,
      matches,
      ambiguous: matches.length > 0,
      mode,
    };
  }

  function resolveDanceFromLibrary(data, parsedInput) {
    const parsed = typeof parsedInput === "string" ? parseSongFileName(parsedInput) : parsedInput;
    const songs = normalizeLibraryData(data).songs;
    const candidates = [...new Set([parsed?.titleKey, parsed?.rawKey, normalizeSearchText(parsed?.stem)].filter(Boolean))];
    if (!candidates.length) {
      return resolveMatches([], "none");
    }

    const exact = songs.filter((song) => candidates.includes(normalizeSearchText(song.title)));
    if (exact.length) {
      return resolveMatches(exact, "exact");
    }

    const fuzzy = songs.filter((song) => {
      const titleKey = normalizeSearchText(song.title);
      return candidates.some((candidate) => candidate.length >= 4 && (titleKey.includes(candidate) || candidate.includes(titleKey)));
    });
    if (fuzzy.length) {
      return resolveMatches(fuzzy, "fuzzy");
    }

    return resolveMatches([], "none");
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return {};
    }
  }

  function utf8ToBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return global.btoa(binary);
  }

  function createSyncChannel() {
    if (!("BroadcastChannel" in global)) return null;
    return new BroadcastChannel(SYNC_CHANNEL);
  }

  function broadcastLibraryUpdate(data) {
    const channel = createSyncChannel();
    if (!channel) return;
    channel.postMessage({
      type: "library-updated",
      data: normalizeLibraryData(data),
    });
    channel.close();
  }

  async function saveLibraryDataToGitHub(data) {
    const token = getGitHubToken();
    if (!token) {
      throw new Error("请先填写带 Contents 写权限的 GitHub Token。");
    }

    const authHeaders = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    let sha = null;
    const currentResponse = await fetch(`${CONTENTS_URL}?ref=${encodeURIComponent(GITHUB.branch)}`, {
      headers: authHeaders,
    });
    if (currentResponse.ok) {
      const currentData = await currentResponse.json();
      sha = currentData.sha || null;
    } else if (currentResponse.status !== 404) {
      const errorData = await safeJson(currentResponse);
      throw new Error(errorData.message || "读取 GitHub 上的舞曲库失败。");
    }

    const normalized = normalizeLibraryData(data);
    const payload = {
      message: `update dance library ${new Date().toISOString()}`,
      content: utf8ToBase64(`${JSON.stringify(normalized, null, 2)}\n`),
      branch: GITHUB.branch,
    };
    if (sha) payload.sha = sha;

    const saveResponse = await fetch(CONTENTS_URL, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const saveData = await safeJson(saveResponse);
    if (!saveResponse.ok) {
      throw new Error(saveData.message || "保存到 GitHub 失败。");
    }

    cacheLibraryData(normalized);
    broadcastLibraryUpdate(normalized);
    return {
      data: normalized,
      commitUrl: saveData.commit?.html_url || "",
    };
  }

  global.DanceLibraryTools = {
    BALLROOM,
    CACHE_KEY,
    COLLECTIVE,
    CONTENTS_URL,
    FRAME,
    GITHUB,
    HANDLE,
    RAW_URL,
    SYNC_CHANNEL,
    TOKEN_KEY,
    broadcastLibraryUpdate,
    cacheLibraryData,
    classifyDanceGroup,
    clearGitHubToken,
    createSyncChannel,
    defaultLibraryData,
    entryKey,
    escapeHtml,
    getGitHubToken,
    loadLibraryData,
    mergeLibraryEntries,
    normalizeDanceLabel,
    normalizeLibraryData,
    normalizeSearchText,
    openGitHubLoginWindow,
    openGitHubTokenWindow,
    parseSongFileName,
    queryLibrarySongs,
    readCachedLibraryData,
    resolveDanceFromLibrary,
    saveLibraryDataToGitHub,
    setGitHubToken,
  };
})(window);
