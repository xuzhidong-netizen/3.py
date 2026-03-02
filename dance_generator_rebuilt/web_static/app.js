const CLUBS = [
  "华中大国际标准交谊舞俱乐部",
  "武汉大学交谊舞协会",
  "中国地质大学（武汉）交谊舞协会",
  "华中农业大学国标舞俱乐部",
];

const PLACES = ["老年活动中心", "紫菘活动中心", "博士生之家", "韵苑体育馆", "西教工西厅", "东教工二楼"];
const CLOUD_SAMPLE_URL = "/static/1.24-top3.zip";
const CLOUD_PLAYLIST_URL = "/static/cloud_sample.json";
const CLOUD_FULL_URL = "https://github.com/xuzhidong-netizen/2.py/releases/download/v1.24-assets/1.24.zip";
const CLOUD_FULL_PLAYLIST_URL = "/static/cloud_full.json";

const state = {
  danceList: null,
  issues: [],
  exportedFiles: null,
  currentAudioIndex: 0,
  sequenceMode: false,
};

const el = {};

function cacheElements() {
  [
    "pathInput", "titleInput", "authorInput", "clubInput", "placeInput", "dateInput", "weekdayInput", "timeInput",
    "countStat", "durationStat", "distributionList", "songsBody", "issues", "issueBadge", "log",
    "previewImage", "previewCaption", "exportedFiles", "audioPlayer"
  ].forEach((id) => { el[id] = document.getElementById(id); });
}

function fillSelect(select, values) {
  select.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function log(message) {
  const item = document.createElement("div");
  item.className = "log-entry";
  item.textContent = message;
  el.log.prepend(item);
}

function secondsToClock(total) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function collectMeta() {
  return {
    title: el.titleInput.value.trim() || "青春舞会舞曲",
    name: el.authorInput.value.trim() || "冬冬",
    club: el.clubInput.value,
    place: el.placeInput.value,
    date: el.dateInput.value.trim(),
    time: [el.weekdayInput.value.trim(), el.timeInput.value.trim()].filter(Boolean),
  };
}

function syncMetaFromState() {
  if (!state.danceList) return;
  el.pathInput.value = state.danceList.path || "";
  el.titleInput.value = state.danceList.title || "";
  el.authorInput.value = state.danceList.name || "";
  el.clubInput.value = state.danceList.club || CLUBS[0];
  el.placeInput.value = state.danceList.place || PLACES[0];
  el.dateInput.value = state.danceList.date || "";
  el.weekdayInput.value = state.danceList.time?.[0] || "";
  el.timeInput.value = state.danceList.time?.[1] || "";
}

function buildDanceListFromTable() {
  const rows = [...el.songsBody.querySelectorAll("tr")];
  const parts = [];
  let currentPart = null;
  rows.forEach((row) => {
    if (row.dataset.type === "part") {
      currentPart = { part_title: row.querySelector("[data-part-title]").value.trim(), music: [] };
      parts.push(currentPart);
      return;
    }
    if (!currentPart) {
      currentPart = { part_title: "", music: [] };
      parts.push(currentPart);
    }
    currentPart.music.push({
      num: Number(row.querySelector("[data-num]").textContent),
      dance: row.querySelector("[data-dance]").value.trim(),
      title: row.querySelector("[data-title]").value.trim(),
      choose: row.querySelector("[data-choose]").checked,
      duration: Number(row.dataset.duration),
      other: row.dataset.other || null,
      speed: row.dataset.speed || null,
      dancetype: row.dataset.dancetype || null,
      md5: row.dataset.md5,
      filepath: row.dataset.filepath,
      filename: row.dataset.filename,
      folder_name: row.dataset.folderName || "",
      is_change: row.dataset.isChange === "true",
    });
  });
  return {
    ...(state.danceList || {}),
    ...collectMeta(),
    path: el.pathInput.value.trim(),
    parts,
  };
}

function renderStats() {
  const list = state.danceList;
  if (!list) return;
  el.countStat.textContent = list.count;
  el.durationStat.textContent = secondsToClock(list.duration);
  const distribution = list.distribution || { handle: [], frame: [], ballroom: [], collective: [] };
  const items = [
    `拉手舞 ${distribution.handle.reduce((a, b) => a + b, 0)} 首`,
    `架型舞 ${distribution.frame.reduce((a, b) => a + b, 0)} 首`,
    `国标舞 ${distribution.ballroom.reduce((a, b) => a + b, 0)} 首`,
    `集体舞 ${distribution.collective.reduce((a, b) => a + b, 0)} 首`,
  ];
  el.distributionList.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderIssues() {
  el.issueBadge.textContent = state.issues.length;
  el.issues.innerHTML = state.issues.map((issue) => `
    <div class="issue ${issue.level}">
      <strong>${issue.level === "error" ? "错误" : "提醒"}</strong>
      <div>${issue.message}</div>
    </div>
  `).join("");
}

function renderExports() {
  const files = state.exportedFiles;
  if (!files) {
    el.exportedFiles.innerHTML = "<li>暂无输出</li>";
    el.previewImage.style.display = "none";
    el.previewCaption.textContent = "还没有生成 PNG";
    return;
  }
  el.exportedFiles.innerHTML = Object.entries(files)
    .filter(([key]) => key !== "preview_url")
    .map(([key, value]) => `<li><strong>${key}</strong><br><a class="file-link" href="/api/file?path=${encodeURIComponent(value)}" target="_blank">${value}</a></li>`)
    .join("");
  if (files.preview_url) {
    el.previewImage.src = `${files.preview_url}&ts=${Date.now()}`;
    el.previewImage.style.display = "block";
    el.previewCaption.textContent = files.png;
  }
}

function updatePlayingRow() {
  const activeNum = state.currentAudioIndex + 1;
  let activeRow = null;
  [...el.songsBody.querySelectorAll(".song-row")].forEach((row) => {
    const rowNum = Number(row.querySelector("[data-num]")?.textContent || "0");
    const isActive = rowNum === activeNum;
    row.classList.toggle("is-playing", isActive);
    if (isActive) activeRow = row;
  });
  if (activeRow) {
    activeRow.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderTable() {
  const list = state.danceList;
  if (!list) {
    el.songsBody.innerHTML = "";
    return;
  }
  const rows = [];
  list.parts.forEach((part, partIndex) => {
    if (list.parts.length > 1 || part.part_title) {
      rows.push(`
        <tr class="part-row" data-type="part">
          <td colspan="3"><input class="inline-input" data-part-title value="${part.part_title || `分场${partIndex + 1}`}"></td>
          <td colspan="4">分场时长 ${secondsToClock(part.duration)}</td>
        </tr>
      `);
    }
    part.music.forEach((song) => {
      rows.push(`
        <tr class="song-row" draggable="true" data-type="song" data-md5="${song.md5}" data-duration="${song.duration}" data-other="${song.other || ""}" data-speed="${song.speed || ""}" data-dancetype="${song.dancetype || ""}" data-filepath="${song.filepath}" data-filename="${song.filename}" data-folder-name="${song.folder_name || ""}" data-is-change="${song.is_change}">
          <td data-num>${song.num}</td>
          <td><input class="inline-input" data-title value="${song.title}"></td>
          <td><input class="inline-input" data-dance value="${song.dance}"></td>
          <td><input type="checkbox" data-choose ${song.choose ? "checked" : ""}></td>
          <td>${secondsToClock(song.duration)}</td>
          <td>${song.md5}</td>
          <td>
            <div class="row-actions">
              <button type="button" data-action="play">播放</button>
              <button type="button" data-action="delete">删除</button>
            </div>
          </td>
        </tr>
      `);
    });
  });
  el.songsBody.innerHTML = rows.join("");
  wireTableInteractions();
}

function renderAll() {
  syncMetaFromState();
  renderStats();
  renderIssues();
  renderTable();
  renderExports();
  updatePlayingRow();
}

function getCurrentSongs() {
  return state.danceList?.parts?.flatMap((part) => part.music) || [];
}

async function refreshState() {
  state.danceList = buildDanceListFromTable();
  const data = await api("/api/update", {
    method: "POST",
    body: JSON.stringify({ dance_list: state.danceList }),
  });
  state.danceList = data.dance_list;
  renderAll();
}

async function loadInitialState() {
  const data = await api("/api/state");
  state.danceList = data.dance_list;
  renderAll();
}

async function handleLoad() {
  const data = await api("/api/load", {
    method: "POST",
    body: JSON.stringify({
      path: el.pathInput.value.trim(),
      meta: collectMeta(),
    }),
  });
  state.danceList = data.dance_list;
  state.issues = [];
  state.exportedFiles = null;
  renderAll();
  log("舞曲目录已加载");
}

async function handleCheck() {
  state.danceList = buildDanceListFromTable();
  const data = await api("/api/check", {
    method: "POST",
    body: JSON.stringify({ dance_list: state.danceList }),
  });
  state.danceList = data.dance_list;
  state.issues = data.issues;
  renderAll();
  log(`规则检查完成，共 ${state.issues.length} 条提示`);
}

async function handleExport() {
  state.danceList = buildDanceListFromTable();
  const data = await api("/api/export", {
    method: "POST",
    body: JSON.stringify({ dance_list: state.danceList, output_dir: "." }),
  });
  state.danceList = data.dance_list;
  state.exportedFiles = data.files;
  renderAll();
  log("已生成 TXT / HTML / PDF / PNG");
}

async function handleSave(method) {
  state.danceList = buildDanceListFromTable();
  const data = await api("/api/save", {
    method: "POST",
    body: JSON.stringify({ dance_list: state.danceList, method }),
  });
  state.danceList = data.dance_list;
  renderAll();
  log(`舞曲文件已${method === "copy" ? "复制" : "移动"}保存到 ${data.destination}`);
}

async function handleAddSong() {
  const filePath = window.prompt("输入要追加的舞曲文件绝对路径");
  if (!filePath) return;
  state.danceList = buildDanceListFromTable();
  const data = await api("/api/add-song", {
    method: "POST",
    body: JSON.stringify({ dance_list: state.danceList, file_path: filePath }),
  });
  state.danceList = data.dance_list;
  renderAll();
  log("已追加舞曲");
}

function addPart() {
  const list = buildDanceListFromTable();
  list.parts.push({ part_title: `分场${list.parts.length + 1}`, music: [] });
  state.danceList = list;
  renderAll();
  log("已增加分场");
}

function deleteLastPart() {
  const list = buildDanceListFromTable();
  if (list.parts.length <= 1) {
    log("至少保留一个分场");
    return;
  }
  list.parts.pop();
  state.danceList = list;
  renderAll();
  refreshState().then(() => log("已删除最后分场"));
}

function deleteSongRow(row) {
  row.remove();
  refreshState().then(() => log("已删除舞曲"));
}

function wireTableInteractions() {
  const rows = [...el.songsBody.querySelectorAll(".song-row")];
  let dragged = null;
  rows.forEach((row) => {
    row.addEventListener("dragstart", () => {
      dragged = row;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      dragged = null;
      refreshState();
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      const current = event.currentTarget;
      if (!dragged || current === dragged) return;
      const rect = current.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      current.parentNode.insertBefore(dragged, before ? current : current.nextSibling);
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteSongRow(row));
    row.querySelector('[data-action="play"]').addEventListener("click", () => {
      const index = Number(row.querySelector("[data-num]").textContent) - 1;
      playSongByIndex(index, false);
    });
  });
}

function playSongByIndex(index, sequenceMode = state.sequenceMode) {
  const songs = getCurrentSongs();
  if (!songs.length) {
    log("当前没有可播放的舞曲");
    return;
  }
  const normalizedIndex = ((index % songs.length) + songs.length) % songs.length;
  const song = songs[normalizedIndex];
  state.currentAudioIndex = normalizedIndex;
  state.sequenceMode = sequenceMode;
  el.audioPlayer.src = `/api/file?path=${encodeURIComponent(song.filepath)}`;
  el.audioPlayer.play().catch(() => {});
  log(`正在播放 ${String(song.num).padStart(2, "0")} ${song.dance}-${song.title}`);
  updatePlayingRow();
}

function playNextSong() {
  if (!getCurrentSongs().length) return;
  playSongByIndex(state.currentAudioIndex + 1, state.sequenceMode);
}

function playPreviousSong() {
  if (!getCurrentSongs().length) return;
  playSongByIndex(state.currentAudioIndex - 1, state.sequenceMode);
}

function startSequencePlayback() {
  if (!getCurrentSongs().length) {
    log("当前没有可播放的舞曲");
    return;
  }
  playSongByIndex(state.currentAudioIndex || 0, true);
}

function wireButtons() {
  document.getElementById("loadBtn").addEventListener("click", () => handleLoad().catch((error) => log(error.message)));
  document.getElementById("loadCloudBtn").addEventListener("click", () => loadCloudSample().catch((error) => log(error.message)));
  document.getElementById("downloadCloudBtn").addEventListener("click", () => window.open(CLOUD_SAMPLE_URL, "_blank"));
  document.getElementById("loadCloudFullBtn").addEventListener("click", () => loadCloudFullSample().catch((error) => log(error.message)));
  document.getElementById("downloadCloudFullBtn").addEventListener("click", () => window.open(CLOUD_FULL_URL, "_blank"));
  document.getElementById("syncBtn").addEventListener("click", () => refreshState().then(() => log("列表已更新")).catch((error) => log(error.message)));
  document.getElementById("checkBtn").addEventListener("click", () => handleCheck().catch((error) => log(error.message)));
  document.getElementById("exportBtn").addEventListener("click", () => handleExport().catch((error) => log(error.message)));
  document.getElementById("saveCopyBtn").addEventListener("click", () => handleSave("copy").catch((error) => log(error.message)));
  document.getElementById("saveMoveBtn").addEventListener("click", () => handleSave("move").catch((error) => log(error.message)));
  document.getElementById("addSongBtn").addEventListener("click", () => handleAddSong().catch((error) => log(error.message)));
  document.getElementById("addPartBtn").addEventListener("click", addPart);
  document.getElementById("deletePartBtn").addEventListener("click", deleteLastPart);
  document.getElementById("prevBtn").addEventListener("click", playPreviousSong);
  document.getElementById("sequencePlayBtn").addEventListener("click", startSequencePlayback);
  document.getElementById("nextBtn").addEventListener("click", playNextSong);
  document.getElementById("playToggleBtn").addEventListener("click", () => {
    if (el.audioPlayer.paused) el.audioPlayer.play().catch(() => {});
    else el.audioPlayer.pause();
  });
  el.audioPlayer.addEventListener("play", updatePlayingRow);
  el.audioPlayer.addEventListener("pause", updatePlayingRow);
  el.audioPlayer.addEventListener("ended", () => {
    const songs = getCurrentSongs();
    if (!songs.length || !state.sequenceMode) return;
    if (state.currentAudioIndex >= songs.length - 1) {
      state.sequenceMode = false;
      log("顺序播放已完成");
      updatePlayingRow();
      return;
    }
    playSongByIndex(state.currentAudioIndex + 1, true);
  });
}

function initDefaults() {
  fillSelect(el.clubInput, CLUBS);
  fillSelect(el.placeInput, PLACES);
}

async function loadCloudSample() {
  try {
    const response = await fetch(CLOUD_PLAYLIST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("云端歌单读取失败");
    }
    const playlist = await response.json();
    const playableTracks = (playlist.tracks || []).filter((track) => track.audio_url);
    if (!playableTracks.length) {
      log("云端歌单暂未配置单曲直链，已打开前3首示例包下载链接");
      window.open(playlist.download_url || CLOUD_SAMPLE_URL, "_blank");
      return;
    }
    log(`云端歌单已配置 ${playableTracks.length} 首可直播放舞曲，当前 Web 版后续可继续接入完整导入。`);
    window.open(playlist.download_url || CLOUD_SAMPLE_URL, "_blank");
  } catch (error) {
    log(`${error.message}，已打开示例包下载链接`);
    window.open(CLOUD_SAMPLE_URL, "_blank");
  }
}

async function loadCloudFullSample() {
  try {
    const response = await fetch(CLOUD_FULL_PLAYLIST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("云端全部歌单读取失败");
    }
    const playlist = await response.json();
    const playableTracks = (playlist.tracks || []).filter((track) => track.audio_url);
    if (!playableTracks.length) {
      log("云端全部歌单暂未配置单曲直链，已打开全部示例包下载链接");
      window.open(playlist.download_url || CLOUD_FULL_URL, "_blank");
      return;
    }
    log(`云端全部歌单已配置 ${playableTracks.length} 首可直播放舞曲，当前 Web 版后续可继续接入完整导入。`);
    window.open(playlist.download_url || CLOUD_FULL_URL, "_blank");
  } catch (error) {
    log(`${error.message}，已打开全部示例包下载链接`);
    window.open(CLOUD_FULL_URL, "_blank");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  initDefaults();
  wireButtons();
  try {
    await loadInitialState();
  } catch (error) {
    log(error.message);
  }
});
