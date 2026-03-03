(function (global) {
  const HANDLE = ["伦巴", "平四", "吉特巴"];
  const FRAME = ["慢四", "慢三", "并四", "快三", "中三", "中四"];
  const BALLROOM = ["华尔兹", "探戈", "维也纳", "狐步", "快步", "国标伦巴", "国标恰恰", "桑巴", "牛仔", "斗牛", "阿根廷探戈"];
  const COLLECTIVE = ["青春16步", "花火16步", "32步", "64步", "兔子舞", "集体恰恰", "阿拉伯之夜", "马卡琳娜", "玛卡琳娜", "蒙古舞"];
  const KNOWN = new Set([...HANDLE, ...FRAME, ...BALLROOM, ...COLLECTIVE, "开场曲", "结束曲"]);
  const CACHE_KEY = "dance-library-cache-v1";
  const TOKEN_KEY = "dance-library-github-token-v1";
  const SYNC_CHANNEL = "dance-library-sync-v1";
  const BACKEND_API_PATH = "/api/library";
  const GITHUB_LOGIN_URL = "https://github.com/login";
  const GITHUB_PAT_NEW_URL = "https://github.com/settings/personal-access-tokens/new";
  const GITHUB = {
    owner: "xuzhidong-netizen",
    repo: "3.py",
    branch: "main",
    path: "dance_generator_rebuilt/web_static/dance_library.json",
  };
  const BACKEND_APP_ORIGINS = [
    "http://ZhidongdeMac-mini.local:8000",
    "http://127.0.0.1:8000",
    "http://192.168.1.11:8000",
  ];
  const REPO_URL = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}`;
  const CONTENTS_URL = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/contents/${GITHUB.path.split("/").map(encodeURIComponent).join("/")}`;
  const RAW_URL = `https://raw.githubusercontent.com/${GITHUB.owner}/${GITHUB.repo}/${GITHUB.branch}/${GITHUB.path}`;
  const REQUEST_TIMEOUT_MS = 20000;
  const SAVE_RETRY_LIMIT = 2;
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

  function combineLibraryData(...payloads) {
    const normalizedPayloads = payloads
      .filter(Boolean)
      .map((payload) => normalizeLibraryData(payload));
    const latestUpdatedAt = normalizedPayloads
      .map((payload) => String(payload.updated_at || ""))
      .sort()
      .at(-1) || "";

    return normalizeLibraryData({
      version: 1,
      updated_at: latestUpdatedAt,
      songs: normalizedPayloads.flatMap((payload) => payload.songs || []),
    });
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
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(normalizeLibraryData(data)));
      return true;
    } catch (error) {
      return false;
    }
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

  function buildGitHubAuthHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${String(token || "").trim()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function getResponseHeader(response, name) {
    try {
      return String(response?.headers?.get?.(name) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function parseScopesHeader(value) {
    return String(value || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
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
    const response = await fetchWithTimeout(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`读取失败：${response.status}`);
    }
    return response.json();
  }

  function canUseBackendApi() {
    return /^https?:/i.test(String(global.location?.href || ""));
  }

  function isGitHubStaticPage() {
    try {
      const href = String(global.location?.href || "");
      return /github\.io/i.test(new URL(href).hostname || "");
    } catch (error) {
      return false;
    }
  }

  function uniqueItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = String(item || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getBackendAppOrigins() {
    try {
      const href = String(global.location?.href || "");
      const currentUrl = href ? new URL(href) : null;
      if (currentUrl && /^https?:/i.test(currentUrl.protocol) && !/github\.io/i.test(currentUrl.hostname || "")) {
        return uniqueItems([currentUrl.origin, ...BACKEND_APP_ORIGINS]);
      }
    } catch (error) {
    }
    return uniqueItems(BACKEND_APP_ORIGINS);
  }

  function getBackendPageCandidates(relativePath = "/web_static/library.html") {
    return getBackendAppOrigins().map((origin) => new URL(relativePath, `${origin}/`).toString());
  }

  function getPreferredBackendPageUrl(relativePath = "/web_static/library.html") {
    return getBackendPageCandidates(relativePath)[0] || "";
  }

  function buildNoBackendTokenError() {
    const backendPageUrl = getPreferredBackendPageUrl("/web_static/library.html");
    if (isGitHubStaticPage()) {
      const error = new Error(
        backendPageUrl
          ? `当前正在使用 GitHub 静态页，不能直接复用本机服务里的 GitHub 登录状态。请打开本机服务版舞曲库继续保存：${backendPageUrl}；如果继续留在当前页，请先在当前浏览器保存 GitHub Token。`
          : "当前正在使用 GitHub 静态页，不能直接复用本机服务里的 GitHub 登录状态。请改用本机服务版页面，或先在当前浏览器保存 GitHub Token。"
      );
      error.code = "static_backend_handoff";
      error.backendPageUrl = backendPageUrl;
      return error;
    }
    const error = new Error("当前页面未连接可用后端服务器，且当前浏览器未保存 GitHub Token。");
    error.code = "backend_or_token_missing";
    error.backendPageUrl = backendPageUrl;
    return error;
  }

  function getBackendLibraryUrl() {
    if (!canUseBackendApi()) return "";
    return new URL(BACKEND_API_PATH, global.location.href).toString();
  }

  function buildHttpError(fallbackMessage, response, payload) {
    const error = new Error(payload?.error || payload?.message || `${fallbackMessage}：${response.status}`);
    error.status = response.status;
    return error;
  }

  async function loadLibraryDataFromBackend() {
    const backendUrl = getBackendLibraryUrl();
    if (!backendUrl) {
      throw new Error("当前页面未连接后端舞曲库接口。");
    }
    const response = await fetchWithTimeout(`${backendUrl}?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await safeJson(response);
    if (!response.ok) {
      throw buildHttpError("读取后端舞曲库失败", response, payload);
    }
    const data = normalizeLibraryData(payload?.data);
    cacheLibraryData(data);
    return {
      data,
      source: "backend",
    };
  }

  async function probeBackendAvailability(timeoutMs = 4000) {
    const backendUrl = getBackendLibraryUrl();
    if (!backendUrl) {
      return {
        ok: false,
        source: "backend",
        error: "当前页面没有可探测的后端接口地址。",
      };
    }
    try {
      const response = await fetchWithTimeout(`${backendUrl}?ts=${Date.now()}`, { cache: "no-store" }, Math.max(1000, Number(timeoutMs || 4000)));
      const payload = await safeJson(response);
      if (!response.ok) {
        throw buildHttpError("读取后端舞曲库失败", response, payload);
      }
      return {
        ok: true,
        source: "backend",
        data: normalizeLibraryData(payload?.data),
      };
    } catch (error) {
      return {
        ok: false,
        source: "backend",
        error: error?.message || String(error),
        status: error?.status || 0,
      };
    }
  }

  async function fetchWithTimeout(resource, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? global.setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetch(resource, {
        ...options,
        signal: controller ? controller.signal : options.signal,
      });
    } catch (error) {
      if (controller && error?.name === "AbortError") {
        throw new Error("请求超时，请重试。");
      }
      throw error;
    } finally {
      if (timer) global.clearTimeout(timer);
    }
  }

  async function loadLibraryData() {
    if (getBackendLibraryUrl()) {
      try {
        return await loadLibraryDataFromBackend();
      } catch (error) {
      }
    }
    const urls = [RAW_URL, new URL("./dance_library.json", global.location.href).toString()];
    const mergedCandidates = [readCachedLibraryData()];
    let lastError = null;
    for (const url of [...new Set(urls)]) {
      try {
        const data = normalizeLibraryData(await fetchJson(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`));
        mergedCandidates.push(data);
        const mergedData = combineLibraryData(...mergedCandidates);
        cacheLibraryData(mergedData);
        return {
          data: mergedData,
          source: url,
        };
      } catch (error) {
        lastError = error;
      }
    }
    const fallbackData = combineLibraryData(...mergedCandidates);
    cacheLibraryData(fallbackData);
    return {
      data: fallbackData,
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

  async function inspectGitHubToken(token = getGitHubToken()) {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) {
      return {
        ok: false,
        code: "missing",
        repo: `${GITHUB.owner}/${GITHUB.repo}`,
        branch: GITHUB.branch,
        path: GITHUB.path,
        canReadRepo: false,
        canReadContents: false,
        canPushRepo: false,
        tokenKind: "unknown",
        oauthScopes: [],
        acceptedScopes: [],
        message: "当前浏览器未保存 GitHub Token，请先填写后再检测。",
      };
    }

    const authHeaders = buildGitHubAuthHeaders(normalizedToken);
    const tokenKind = normalizedToken.startsWith("github_pat_") ? "fine-grained" : "classic-or-other";
    const result = {
      ok: false,
      code: "unknown",
      repo: `${GITHUB.owner}/${GITHUB.repo}`,
      branch: GITHUB.branch,
      path: GITHUB.path,
      canReadRepo: false,
      canReadContents: false,
      canPushRepo: false,
      tokenKind,
      oauthScopes: [],
      acceptedScopes: [],
      message: "",
    };

    let repoResponse = null;
    try {
      repoResponse = await fetchWithTimeout(REPO_URL, {
        headers: authHeaders,
        cache: "no-store",
      });
    } catch (error) {
      result.code = "network_error";
      result.message = `检测 GitHub Token 时网络异常：${error?.message || String(error)}`;
      return result;
    }

    const repoPayload = await safeJson(repoResponse);
    result.oauthScopes = parseScopesHeader(getResponseHeader(repoResponse, "x-oauth-scopes"));
    result.acceptedScopes = parseScopesHeader(getResponseHeader(repoResponse, "x-accepted-oauth-scopes"));

    if (!repoResponse.ok) {
      const repoMessage = String(repoPayload?.message || "").trim();
      if (repoResponse.status === 401 || /bad credentials/i.test(repoMessage)) {
        result.code = "invalid_token";
        result.message = "当前 GitHub Token 无效、已过期，或已被撤销，请重新生成后再保存。";
        return result;
      }
      if (repoResponse.status === 404 || /not found/i.test(repoMessage)) {
        result.code = "repo_not_selected";
        result.message = `当前 GitHub Token 看不到仓库 ${GITHUB.owner}/${GITHUB.repo}。请在 Token 里明确选择该仓库后再重试。`;
        return result;
      }
      if (/resource not accessible by personal access token/i.test(repoMessage)) {
        result.code = "repo_access_denied";
        result.message = `当前 GitHub Token 无法访问仓库 ${GITHUB.owner}/${GITHUB.repo}。请确认该 Token 已选择仓库 ${GITHUB.owner}/${GITHUB.repo}。`;
        return result;
      }
      result.code = "repo_request_failed";
      result.message = repoMessage || `检测 GitHub Token 失败：${repoResponse.status}`;
      return result;
    }

    result.canReadRepo = true;
    const permissions = repoPayload?.permissions || {};
    result.canPushRepo = Boolean(permissions.push || permissions.maintain || permissions.admin);
    if (permissions && Object.keys(permissions).length && !result.canPushRepo) {
      result.code = "no_push_permission";
      result.message = `当前 GitHub 账号对仓库 ${GITHUB.owner}/${GITHUB.repo} 没有写入权限，请确认该账号至少具备 push 权限。`;
      return result;
    }

    let contentsResponse = null;
    try {
      contentsResponse = await fetchWithTimeout(`${CONTENTS_URL}?ref=${encodeURIComponent(GITHUB.branch)}`, {
        headers: authHeaders,
        cache: "no-store",
      });
    } catch (error) {
      result.code = "network_error";
      result.message = `检测舞曲库文件权限时网络异常：${error?.message || String(error)}`;
      return result;
    }

    const contentsPayload = await safeJson(contentsResponse);
    if (!contentsResponse.ok && contentsResponse.status !== 404) {
      const contentsMessage = String(contentsPayload?.message || "").trim();
      if (contentsResponse.status === 401 || /bad credentials/i.test(contentsMessage)) {
        result.code = "invalid_token";
        result.message = "当前 GitHub Token 无效、已过期，或已被撤销，请重新生成后再保存。";
        return result;
      }
      if (/resource not accessible by personal access token/i.test(contentsMessage)) {
        result.code = "contents_read_denied";
        result.message = `当前 GitHub Token 无法读取 ${GITHUB.path}。请确认已选择仓库 ${GITHUB.owner}/${GITHUB.repo}，并至少开启 Contents: Read 权限。`;
        return result;
      }
      result.code = "contents_request_failed";
      result.message = contentsMessage || `读取 ${GITHUB.path} 失败：${contentsResponse.status}`;
      return result;
    }

    result.canReadContents = true;
    if (tokenKind === "classic-or-other" && result.oauthScopes.length && !result.oauthScopes.includes("repo")) {
      result.code = "classic_scope_missing";
      result.message = "当前 classic GitHub Token 缺少 repo scope，无法写入仓库文件，请重新生成并勾选 repo。";
      return result;
    }

    result.ok = true;
    result.code = "ready";
    result.message = result.canPushRepo
      ? `当前 GitHub Token 已能读取仓库 ${GITHUB.owner}/${GITHUB.repo} 和舞曲库文件。若保存时仍被 GitHub 拒绝写入，通常是 Token 只开了 Contents: Read only，需要改成 Read and write。`
      : `当前 GitHub Token 已能读取仓库 ${GITHUB.owner}/${GITHUB.repo} 和舞曲库文件。`;
    return result;
  }

  function decodeBase64Utf8(value) {
    const binary = global.atob(String(value || "").replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function parseGitHubLibraryContent(payload) {
    if (!payload?.content) return defaultLibraryData();
    try {
      return normalizeLibraryData(JSON.parse(decodeBase64Utf8(payload.content)));
    } catch (error) {
      return defaultLibraryData();
    }
  }

  function isShaMismatch(response, errorData) {
    const message = String(errorData?.message || "");
    return response?.status === 409 || /does not match/i.test(message);
  }

  function explainGitHubTokenError(response, payload, fallbackMessage, tokenCheck = null) {
    const status = Number(response?.status || 0);
    const message = String(payload?.message || "").trim();
    if (/resource not accessible by personal access token/i.test(message)) {
      if (tokenCheck?.code === "repo_not_selected" || tokenCheck?.code === "repo_access_denied") {
        return new Error(tokenCheck.message);
      }
      if (tokenCheck?.code === "classic_scope_missing") {
        return new Error(tokenCheck.message);
      }
      if (tokenCheck?.code === "no_push_permission") {
        return new Error(tokenCheck.message);
      }
      if (tokenCheck?.canReadContents) {
        return new Error(
          `当前 GitHub Token 已能读取仓库 ${GITHUB.owner}/${GITHUB.repo}，但 GitHub 仍拒绝写入 ${GITHUB.path}。这通常表示该 Token 只有 Contents: Read only，请改成 Contents: Read and write 后再试。`
        );
      }
      return new Error(
        `当前 GitHub Token 无法写入 ${GITHUB.owner}/${GITHUB.repo}。请确认该 Token 已选择仓库 ${GITHUB.owner}/${GITHUB.repo}，并开启 Contents: Read and write 权限。`
      );
    }
    if (status === 401 || /bad credentials/i.test(message)) {
      return new Error("当前 GitHub Token 无效、已过期，或已被撤销，请重新生成后再保存。");
    }
    if (/sso/i.test(message) || /single sign-on/i.test(message)) {
      return new Error("当前 GitHub Token 还没有通过组织 SSO 授权，请先在 GitHub 完成授权后再保存。");
    }
    return new Error(message || fallbackMessage);
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

    const authHeaders = buildGitHubAuthHeaders(token);

    const requestedData = normalizeLibraryData(data);

    for (let attempt = 0; attempt <= SAVE_RETRY_LIMIT; attempt += 1) {
      let sha = null;
      let remoteData = defaultLibraryData();
      const currentResponse = await fetchWithTimeout(`${CONTENTS_URL}?ref=${encodeURIComponent(GITHUB.branch)}`, {
        headers: authHeaders,
      });
      if (currentResponse.ok) {
        const currentData = await currentResponse.json();
        sha = currentData.sha || null;
        remoteData = parseGitHubLibraryContent(currentData);
      } else if (currentResponse.status !== 404) {
        const errorData = await safeJson(currentResponse);
        const tokenCheck = await inspectGitHubToken(token);
        throw explainGitHubTokenError(currentResponse, errorData, "读取 GitHub 上的舞曲库失败。", tokenCheck);
      }

      const normalized = attempt === 0 ? requestedData : combineLibraryData(remoteData, requestedData);
      const payload = {
        message: `update dance library ${new Date().toISOString()}`,
        content: utf8ToBase64(`${JSON.stringify(normalized, null, 2)}\n`),
        branch: GITHUB.branch,
      };
      if (sha) payload.sha = sha;

      const saveResponse = await fetchWithTimeout(CONTENTS_URL, {
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const saveData = await safeJson(saveResponse);
      if (saveResponse.ok) {
        cacheLibraryData(normalized);
        broadcastLibraryUpdate(normalized);
        return {
          data: normalized,
          commitUrl: saveData.commit?.html_url || "",
          attempts: attempt + 1,
        };
      }

      if (attempt < SAVE_RETRY_LIMIT && isShaMismatch(saveResponse, saveData)) {
        continue;
      }
      const tokenCheck = await inspectGitHubToken(token);
      throw explainGitHubTokenError(saveResponse, saveData, "保存到 GitHub 失败。", tokenCheck);
    }

    throw new Error("保存到 GitHub 失败，请稍后重试。");
  }

  async function saveLibraryDataToBackend(data) {
    const backendUrl = getBackendLibraryUrl();
    if (!backendUrl) {
      throw new Error("当前页面未连接后端舞曲库接口。");
    }
    const requestedData = normalizeLibraryData(data);
    const response = await fetchWithTimeout(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: requestedData }),
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      throw buildHttpError("通过后端保存舞曲库失败", response, payload);
    }
    const savedData = normalizeLibraryData(payload?.data || requestedData);
    cacheLibraryData(savedData);
    broadcastLibraryUpdate(savedData);
    return {
      data: savedData,
      commitUrl: payload?.commit_url || "",
      source: "backend",
      attempts: 1,
    };
  }

  async function saveLibraryData(data) {
    let backendError = null;
    if (getBackendLibraryUrl()) {
      try {
        return await saveLibraryDataToBackend(data);
      } catch (error) {
        backendError = error;
      }
    }

    const token = getGitHubToken();
    if (!token) {
      if (backendError?.status && backendError.status >= 500) {
        throw backendError;
      }
      throw buildNoBackendTokenError();
    }

    const result = await saveLibraryDataToGitHub(data);
    return {
      ...result,
      source: "github-token",
      fallbackFromBackend: Boolean(backendError),
      backendError: backendError?.message || "",
    };
  }

  global.DanceLibraryTools = {
    BACKEND_API_PATH,
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
    combineLibraryData,
    clearGitHubToken,
    createSyncChannel,
    defaultLibraryData,
    entryKey,
    escapeHtml,
    getBackendLibraryUrl,
    getBackendPageCandidates,
    getPreferredBackendPageUrl,
    getGitHubToken,
    loadLibraryData,
    loadLibraryDataFromBackend,
    mergeLibraryEntries,
    normalizeDanceLabel,
    normalizeLibraryData,
    normalizeSearchText,
    openGitHubLoginWindow,
    openGitHubTokenWindow,
    inspectGitHubToken,
    probeBackendAvailability,
    parseSongFileName,
    queryLibrarySongs,
    readCachedLibraryData,
    resolveDanceFromLibrary,
    saveLibraryData,
    saveLibraryDataToBackend,
    saveLibraryDataToGitHub,
    setGitHubToken,
  };
})(window);
