// 状态机与组装：landing / stage(camera|photo|video)（设计 §4）
import * as api from "./api.js";
import { Avatar } from "./avatar.js";
import { MeshOverlay } from "./mesh.js";
import { Readout } from "./readout.js";
import { SourceInput } from "./input.js";

const $ = (id) => document.getElementById(id);
const els = {
  statusText: $("status-text"),
  fps: $("fps"),
  stopBtn: $("stop-btn"),
  dropzone: $("dropzone"),
  fileInput: $("file-input"),
  btnCamera: $("btn-camera"),
  btnBrowse: $("btn-browse"),
  btnSecondary: $("btn-secondary"),
  sourceView: $("source-view"),
  sourceBox: $("source-box"),
  sourceImage: $("source-image"),
  sourceVideo: $("source-video"),
  meshCanvas: $("mesh-canvas"),
  nofaceBadge: $("noface-badge"),
  renderIdle: $("render-idle"),
  backendSelect: $("backend-select"),
  meshToggle: $("mesh-toggle"),
  stripTitle: $("strip-title"),
  stripTag: $("strip-tag"),
  polaroidRow: $("polaroid-row"),
  readoutEl: $("readout"),
  overlay: $("overlay"),
  overlayText: $("overlay-text"),
  overlayBtn: $("overlay-btn"),
};

let state = "landing"; // landing | camera | photo | video
let ws = null;
let wsReconnectTimer = null;
let lastFaceMsgAt = 0;
let faceMsgCount = 0;
let videoFrames = []; // video 模式：后端逐帧结果（按 timestampMs 升序）

const input = new SourceInput({ box: els.sourceBox, image: els.sourceImage, video: els.sourceVideo });
const mesh = new MeshOverlay(els.meshCanvas);
const readout = new Readout(els.readoutEl);
let avatar = null;

/* ---------------- 工具 ---------------- */
function setStatus(text) {
  els.statusText.textContent = text;
}

function showOverlay(text, withRetry) {
  els.overlayText.textContent = text;
  els.overlayBtn.hidden = !withRetry;
  els.overlay.hidden = false;
}

function hideOverlay() {
  els.overlay.hidden = true;
}

function flatLandmarks(lm) {
  if (!lm) return null;
  if (Array.isArray(lm[0])) return lm.flat(); // photo API 的嵌套形式
  return lm; // WS / video NDJSON 的 flat 形式
}

function applyFrame({ blendshapes, headEuler, landmarks }) {
  if (blendshapes) {
    avatar.setBlendshapes(blendshapes);
    readout.update(blendshapes);
    els.renderIdle.hidden = true;
  }
  if (headEuler) avatar.setHeadEuler(headEuler);
  mesh.draw(flatLandmarks(landmarks));
}

/* ---------------- 状态切换 ---------------- */
function enterStage(mode) {
  state = mode;
  els.dropzone.hidden = true;
  els.sourceView.hidden = false;
  els.polaroidRow.hidden = true;
  els.readoutEl.hidden = false;
  els.stopBtn.hidden = false;
  els.btnSecondary.hidden = mode === "camera";
  els.btnSecondary.textContent = mode === "photo" ? "换一张" : "换一个";
  els.stripTitle.textContent = "实时表情读数";
  els.stripTag.textContent = "LIVE BLENDSHAPES";
  readout.reset();
  if (window.gsap) {
    gsap.fromTo(els.sourceView, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.48, ease: "power3.out" });
    gsap.fromTo(els.readoutEl, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, delay: 0.1 });
  }
}

function backToLanding() {
  state = "landing";
  if (ws) { try { ws.close(); } catch {} ws = null; }
  clearTimeout(wsReconnectTimer);
  input.stop();
  mesh.clear();
  readout.reset();
  videoFrames = [];
  els.sourceView.hidden = true;
  els.dropzone.hidden = false;
  els.polaroidRow.hidden = false;
  els.readoutEl.hidden = true;
  els.stopBtn.hidden = true;
  els.btnSecondary.hidden = true;
  els.nofaceBadge.hidden = true;
  els.renderIdle.hidden = false;
  els.stripTitle.textContent = "近期示例 · 来自我们的工作室";
  els.stripTag.textContent = "PINBOARD SAMPLES";
  setStatus("待机");
  els.fps.textContent = "";
}

/* ---------------- camera 模式 ---------------- */
function startCamera() {
  enterStage("camera");
  setStatus("正在连接摄像头…");
  input.startCamera((err) => {
    if (state !== "camera") return;
    setStatus("摄像头帧流不可用，试试照片模式");
    console.warn(err);
  });
  openFaceWS();
}

function openFaceWS() {
  if (state !== "camera") return;
  ws = api.connectFaceWS(
    (msg) => {
      if (state !== "camera") return;
      lastFaceMsgAt = performance.now();
      faceMsgCount++;
      els.nofaceBadge.hidden = true;
      applyFrame(msg);
    },
    () => setStatus("● 运行中（camera）"),
    () => {
      if (state !== "camera") return;
      setStatus("连接断开，3s 后重连…");
      wsReconnectTimer = setTimeout(openFaceWS, 3000);
    }
  );
}

/* ---------------- photo 模式 ---------------- */
async function startPhoto(file) {
  enterStage("photo");
  setStatus("分析照片中…");
  input.setPhoto(file);
  try {
    const result = await api.analyzePhoto(file);
    applyFrame(result);
    setStatus(`photo · 后端 ${result.backend} · 推理 ${result.inferenceMs} ms`);
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

/* ---------------- video 模式 ---------------- */
function startVideo(file) {
  enterStage("video");
  setStatus("上传并逐帧处理中…");
  input.setVideo(file);
  videoFrames = [];
  api.streamVideo(
    file,
    (item) => {
      if (item.ok && item.blendshapes) videoFrames.push(item);
    },
    (err) => setStatus(String(err.message || err))
  ).then(() => {
    if (state === "video") setStatus(`video · 已处理 ${videoFrames.length} 帧 · 播放即同步`);
  });
}

function onVideoTime() {
  if (state !== "video" || !videoFrames.length) return;
  const t = els.sourceVideo.currentTime * 1000;
  // 二分：最后一个 timestampMs <= t 的帧
  let lo = 0, hi = videoFrames.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (videoFrames[mid].timestampMs <= t) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best >= 0 && t - videoFrames[best].timestampMs < 600) {
    applyFrame(videoFrames[best]);
  }
}

/* ---------------- 后端热切换 ---------------- */
async function refreshBackends() {
  try {
    const data = await api.listBackends();
    els.backendSelect.innerHTML = "";
    for (const b of data.backends) {
      const opt = document.createElement("option");
      opt.value = b.name;
      opt.textContent = b.available ? b.name : `${b.name}（缺模型）`;
      opt.disabled = !b.available;
      opt.selected = b.name === data.active;
      els.backendSelect.appendChild(opt);
    }
    els.backendSelect.disabled = false;
  } catch {
    els.backendSelect.innerHTML = "<option>后端离线</option>";
  }
}

async function onBackendChange() {
  const name = els.backendSelect.value;
  els.backendSelect.disabled = true;
  try {
    await api.switchBackend(name);
    setStatus(`后端已切换：${name}`);
  } catch (e) {
    setStatus(String(e.message || e));
  } finally {
    await refreshBackends();
  }
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  els.btnCamera.addEventListener("click", startCamera);
  els.btnBrowse.addEventListener("click", () => els.fileInput.click());
  els.btnSecondary.addEventListener("click", () => els.fileInput.click());
  els.stopBtn.addEventListener("click", backToLanding);
  els.backendSelect.addEventListener("change", onBackendChange);
  els.meshToggle.addEventListener("change", () => {
    mesh.enabled = els.meshToggle.checked;
    if (!mesh.enabled) mesh.clear();
  });
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      avatar.setView(btn.dataset.view);
      localStorage.setItem("dash.view", btn.dataset.view); // 默认视角记忆
    });
  });
  els.fileInput.addEventListener("change", () => {
    const f = els.fileInput.files[0];
    if (f) routeFile(f);
    els.fileInput.value = "";
  });
  for (const ev of ["dragover", "dragleave", "drop"]) {
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.toggle("dragover", ev === "dragover");
      if (ev === "drop" && e.dataTransfer.files.length) routeFile(e.dataTransfer.files[0]);
    });
  }
  els.sourceVideo.addEventListener("loadedmetadata", () => mesh.fitTo(els.sourceVideo));
  els.sourceVideo.addEventListener("timeupdate", onVideoTime); // 只绑一次，state 守卫
  els.sourceImage.addEventListener("load", () => mesh.fitTo(els.sourceImage));
  window.addEventListener("resize", () => mesh.fitTo(input.activeMedia()));
  els.overlayBtn.addEventListener("click", () => location.reload());
}

function routeFile(file) {
  if (file.type.startsWith("image/")) startPhoto(file);
  else if (file.type.startsWith("video/")) startVideo(file);
  else setStatus("这不是照片或视频文件");
}

/* ---------------- 周期任务：FPS、无人脸检测、零值心跳 ---------------- */
setInterval(() => {
  if (state !== "camera") return;
  els.fps.textContent = `● ${(faceMsgCount / 2).toFixed(0)} FPS`;
  faceMsgCount = 0;
  if (performance.now() - lastFaceMsgAt > 800 && lastFaceMsgAt > 0) {
    els.nofaceBadge.hidden = false;
  }
}, 2000);

// 零值心跳：150ms 没收到人脸帧就以 0 推进时间轴（轨道不冻结）
setInterval(() => {
  if (state === "camera" && performance.now() - lastFaceMsgAt > 150) {
    readout.update([]);
  }
}, 100);

/* ---------------- 入场动效（§6.5：被钉上板的感觉） ---------------- */
function entrance() {
  if (!window.gsap) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from("#statusbar", { y: -30, autoAlpha: 0, duration: 0.48 })
    .from("#input-card", { y: 40, autoAlpha: 0, rotation: -1.2, duration: 0.6 }, "-=0.2")
    .from("#output-card", { y: 40, autoAlpha: 0, rotation: 1.1, duration: 0.6 }, "-=0.45")
    .from("#strip", { y: 24, autoAlpha: 0, duration: 0.5 }, "-=0.35")
    .from(".pushpin", { scale: 0, duration: 0.35, ease: "back.out(3)", stagger: 0.08 }, "-=0.2")
    .from(".polaroid", { y: 16, autoAlpha: 0, stagger: 0.08, duration: 0.4 }, "-=0.3")
    .from(".rail-box", { autoAlpha: 0, y: -8, stagger: 0.1, duration: 0.35 }, "-=0.2");
}

/* ---------------- 启动 ---------------- */
async function boot() {
  bindEvents();
  entrance();
  try {
    avatar = new Avatar($("avatar-canvas"));
  } catch {
    showOverlay("这个浏览器不支持 WebGL，换 Chrome / Edge 试试", false);
    return;
  }
  // 应用记忆的默认视角（localStorage）
  const savedView = localStorage.getItem("dash.view");
  if (savedView && Avatar.VIEWS[savedView]) {
    avatar.setView(savedView);
    document.querySelectorAll(".view-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === savedView)
    );
  }
  try {
    await api.health();
  } catch {
    showOverlay("后端没启动。先运行：python -m showcase.backend serve", true);
    return;
  }
  refreshBackends();
  try {
    await avatar.load("assets/three-vrm-girl.vrm");
  } catch (e) {
    showOverlay(`皮套人模型没加载成功：${e.message || e}`, true);
  }
}

boot();
