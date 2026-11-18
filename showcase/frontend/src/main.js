// 状态机与组装：landing / stage(camera|photo|video)
// 感知全部在浏览器本地（MediaPipe Tasks JS），服务器只是静态托管 + 模型分发。
import { Avatar } from "./avatar.js?v=26";
import { VrmBackend } from "./backends/vrm_backend.js?v=26";
import { AvatarManager } from "./avatar_manager.js?v=26";
import { GnmBackend } from "./backends/gnm_backend.js?v=26";
import { MeshOverlay } from "./mesh.js?v=26";
import { Readout, GROUPS_A, GROUPS_B } from "./readout.js?v=26";
import { SourceInput } from "./input.js?v=26";
import { poseMetrics, handMetrics } from "./metrics.js?v=26";
import * as perception from "./perception.js?v=26";
import { ensureEntry, ensureModel, blobToBuffer, fetchManifest, modelKind } from "./modelstore.js?v=26";
import { createBenchmarkPanel, startCollectMode } from "./benchmark.js?v=26";
import { resolveVariant, getVariant } from "./variants.js?v=26";

const collectQuery = new URLSearchParams(location.search);
const collectMode = collectQuery.get("bench") === "collect";
const collectSeconds = Math.max(1, Math.min(300, Number(collectQuery.get("seconds")) || 30));
const collectLabel = collectQuery.get("label") || "";
const variantKey = resolveVariant();
const variantConfig = getVariant(variantKey);
if (variantConfig.key !== "mp_full") {
  document.title = `DASH · 微表情数字虚拟人 · ${variantConfig.label}`;
}

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
  modelSelect: $("model-select"),
  faceModeSelect: $("face-mode-select"),
  avatarSelect: $("avatar-select"),
  avatarProgress: $("avatar-progress"),
  avatarProgressText: $("avatar-progress-text"),
  avatarProgressBar: $("avatar-progress-bar"),
  avatarError: $("avatar-error"),
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
let camRunning = false;
let lastFacePresentAt = 0;
let frameCount = 0;
let videoFrames = []; // video 模式：本地批处理的逐帧结果
let ready = false;    // 推理引擎 + 模型就绪前，三个输入按钮全部拦截

// 感知实例（boot 时创建；切模型时重建）
let faceLmVideo = null;
let faceLmImage = null;
let activeModelName = "face_landmarker";

// 数字虚拟人：manifest 条目 + 懒加载（首次需要时才下载/解析）
const FALLBACK_AVATAR = {
  name: "vrm-girl",
  kind: "avatar",
  label: "少女（默认）",
  url: "assets/three-vrm-girl.vrm",
  version: "1.0.0",
  default: true,
};
let avatarEntries = [];
let activeAvatarName = FALLBACK_AVATAR.name;
let loadedAvatarName = null;
let avatarLoadingPromise = null;
let manifestCache = null;
let benchActive = false;
let bench = null;
let collectPanel = null;
let benchMode = "quick";
let variantRuntime = null;

// 版本：A 面部（当前）；B 全身（二期，按钮置灰）
const MODE_VIEWS = { a: ["head"], b: ["head", "half", "full"] };
let mode = "a";
let faceMode = "preset"; // preset | custom

const input = new SourceInput({ box: els.sourceBox, image: els.sourceImage, video: els.sourceVideo });
const mesh = new MeshOverlay(els.meshCanvas);
const readout = new Readout(els.readoutEl);
let avatar = null;
let avatarManager = null;
let vrmBackend = null;
let gnmBackend = null;
let gnmLoadController = null;
let gnmLoadToken = 0;
let gnmLoading = false;
let avatarBackend = "vrm";
let lastFaceFrame = null;

/* ---------------- 工具 ---------------- */
function setStatus(text) {
  els.statusText.textContent = text;
  els.statusText.title = text;
}

function showOverlay(text, withRetry) {
  els.overlayText.textContent = text;
  els.overlayBtn.hidden = !withRetry;
  els.overlay.hidden = false;
}

/* ---------------- 数字虚拟人：manifest 下拉 + 懒加载 + 进度 ---------------- */

function entryLabel(entry) {
  return entry.label || entry.name;
}

function setAvatarProgress(pct, text) {
  if (!text) {
    els.avatarProgress.hidden = true;
    return;
  }
  els.avatarProgress.hidden = false;
  els.avatarProgressText.textContent = text;
  els.avatarProgressBar.classList.toggle("indeterminate", pct == null);
  els.avatarProgressBar.style.transform = pct == null ? "" : `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`;
}

function setAvatarError(text) {
  els.avatarError.textContent = text || "";
  els.avatarError.hidden = !text;
}

// 拉 manifest，填充两个下拉；旧条目没有 kind 时按感知模型处理
async function refreshModels() {
  let manifest;
  try {
    manifest = await fetchManifest();
    manifestCache = manifest;
  } catch {
    manifest = { models: [FALLBACK_AVATAR] };
    manifestCache = manifest;
    setAvatarError("manifest 读取失败，数字虚拟人使用内置默认条目");
  }

  const perceptions = manifest.models.filter((m) => modelKind(m) === "perception");
  els.modelSelect.innerHTML = "";
  for (const m of perceptions) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name === "face_landmarker" ? "mediapipe-task" : m.name;
    opt.selected = m.name === activeModelName;
    els.modelSelect.appendChild(opt);
  }
  if (!perceptions.length) els.modelSelect.innerHTML = "<option>manifest 读取失败</option>";
  els.modelSelect.disabled = perceptions.length < 2;

  avatarEntries = manifest.models.filter((m) => modelKind(m) === "avatar");
  if (!avatarEntries.length) avatarEntries = [FALLBACK_AVATAR];
  const saved = localStorage.getItem("dash.avatar");
  const fallback = avatarEntries.find((e) => e.default) || avatarEntries[0];
  activeAvatarName = avatarEntries.some((e) => e.name === saved) ? saved : fallback.name;

  els.avatarSelect.innerHTML = "";
  for (const entry of avatarEntries) {
    const opt = document.createElement("option");
    opt.value = entry.name;
    opt.textContent = entryLabel(entry);
    opt.selected = entry.name === activeAvatarName;
    els.avatarSelect.appendChild(opt);
  }
  els.avatarSelect.disabled = avatarEntries.length < 2;
}

// 真正需要驱动/显示数字虚拟人时再加载；并发调用共享同一个 Promise
async function ensureAvatarLoaded() {
  if (avatar && avatar.ready && loadedAvatarName === activeAvatarName) return true;
  if (avatarLoadingPromise) return avatarLoadingPromise;

  const entry = avatarEntries.find((e) => e.name === activeAvatarName) || FALLBACK_AVATAR;
  els.avatarSelect.disabled = true;
  avatarLoadingPromise = (async () => {
    setAvatarError("");
    try {
      const { blob, fromCache } = await ensureEntry(entry, (recv, total) => {
        const pct = total ? Math.round((recv / total) * 100) : null;
        const size = `${(recv / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ""} MB`;
        const text = pct == null ? `下载数字虚拟人 ${size}` : `下载数字虚拟人 ${pct}% · ${size}`;
        setAvatarProgress(pct, text);
        setStatus(text);
      });
      setAvatarProgress(null, "解析数字虚拟人模型…");
      setStatus("解析数字虚拟人模型…");
      await avatar.loadFromBlob(blob);
      loadedAvatarName = entry.name;
      els.renderIdle.hidden = true;
      setAvatarProgress(null, null);
      setStatus(`数字虚拟人就绪：${entryLabel(entry)}${fromCache ? "（本地缓存）" : ""}`);
      return true;
    } catch (e) {
      const raw = String(e.message || e);
      const msg = /Failed to fetch|NetworkError|Load failed/i.test(raw)
        ? `网络错误，未能下载 ${entryLabel(entry)}`
        : raw;
      setAvatarProgress(null, null);
      setAvatarError(`数字虚拟人加载失败：${msg}（继续使用当前模型）`);
      setStatus(`数字虚拟人加载失败：${msg}`);
      return false;
    } finally {
      avatarLoadingPromise = null;
      els.avatarSelect.disabled = avatarEntries.length < 2;
    }
  })();
  return avatarLoadingPromise;
}

async function onAvatarChange() {
  const next = els.avatarSelect.value;
  if (next === activeAvatarName && avatar.ready) return;
  const prev = activeAvatarName;
  activeAvatarName = next;
  els.avatarSelect.disabled = true;
  const ok = await ensureAvatarLoaded();
  if (ok) {
    localStorage.setItem("dash.avatar", next);
  } else {
    activeAvatarName = prev;
    els.avatarSelect.value = prev;
  }
  els.avatarSelect.disabled = avatarEntries.length < 2;
}

function flatLandmarks(lm) {
  if (!lm) return null;
  if (Array.isArray(lm[0])) return lm.flat(); // photo API 时代的嵌套数组
  if (typeof lm[0] === "object" && lm[0] !== null && "x" in lm[0]) {
    const out = new Array(lm.length * 3);
    for (let i = 0; i < lm.length; i++) {
      out[i * 3] = lm[i].x;
      out[i * 3 + 1] = lm[i].y;
      out[i * 3 + 2] = lm[i].z;
    }
    return out;
  }
  return lm; // 已是 flat
}

function applyFrame({ blendshapes, headEuler, landmarks, aspect }, { advanceReadout = true, mirror = false, snap = false } = {}) {
  const facePresent = !!landmarks;
  if (facePresent) {
    lastFacePresentAt = performance.now();
    els.nofaceBadge.hidden = true;
    const payload = { blendshapes, headEuler, landmarks, aspect };
    lastFaceFrame = payload;
    if (gnmBackend && gnmBackend.state === "capturing") {
      gnmBackend.captureFrame(payload);
    }
    try {
      avatarManager?.update(payload, { mirror, snap });
    } catch (error) {
      if (avatarBackend === "gnm") fallbackToVrm(error?.message || String(error));
    }
    els.renderIdle.hidden = true;
  }
  mesh.draw(facePresent ? flatLandmarks(landmarks) : null);
  if (advanceReadout) readout.update(facePresent ? blendshapes : [], {});
}

// 预计算一帧的读数分（视频回放模式用：读数跟随视频进度而非墙钟）
function buildScores(frame) {
  const scores = {};
  if (frame.blendshapes) for (const c of frame.blendshapes) scores[c.categoryName] = c.score;
  return scores;
}

/* ---------------- 状态切换 ---------------- */
function enterStage(mode_) {
  state = mode_;
  els.dropzone.hidden = true;
  els.sourceView.hidden = false;
  els.polaroidRow.hidden = true;
  els.readoutEl.hidden = false;
  els.stopBtn.hidden = false;
  els.btnSecondary.hidden = mode_ === "camera";
  els.btnSecondary.textContent = mode_ === "photo" ? "换一张" : "换一个";
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
  camRunning = false;
  input.stop(); // 会停掉 getUserMedia 的 tracks
  mesh.clear();
  readout.reset();
  videoFrames = [];
  if (avatar) {
    avatar.resetPose();
    avatar.setView("head");
  }
  document.querySelectorAll(".view-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === "head")
  );
  els.sourceView.hidden = true;
  els.dropzone.hidden = false;
  els.polaroidRow.hidden = false;
  els.readoutEl.hidden = true;
  els.stopBtn.hidden = true;
  els.btnSecondary.hidden = true;
  els.nofaceBadge.hidden = true;
  els.renderIdle.hidden = !!(avatar && avatar.ready);
  els.stripTitle.textContent = "了解更多";
  els.stripTag.textContent = "LEARN MORE";
  setStatus("待机");
  els.fps.textContent = "";
}

async function detectCurrent(media, mode = "video", ts = performance.now()) {
  const got = await perception.detectFrame({
    landmarker: mode === "image" ? faceLmImage : faceLmVideo,
    runtime: variantRuntime,
    variant: variantConfig,
    media,
    mode,
    ts,
  });
  if (got.frame) {
    const w = media.videoWidth || media.width || media.naturalWidth || 0;
    const h = media.videoHeight || media.height || media.naturalHeight || 0;
    got.frame.aspect = w > 0 && h > 0 ? w / h : 1;
  }
  return got;
}

/* ---------------- camera 模式（本地推理） ---------------- */
async function startCamera() {
  if (!ready) {
    setStatus("推理引擎还在加载，稍候几秒再点…");
    return;
  }
  if (!(await ensureAvatarLoaded())) return;
  enterStage("camera");
  setStatus("正在打开摄像头…");
  try {
    await input.startCamera();
  } catch (e) {
    const insecure = !(location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname));
    setStatus(insecure
      ? "裸 HTTP 页面浏览器禁用了摄像头——请用照片/视频，或在 localhost 打开"
      : "摄像头没权限。点「换一个」改用照片试试");
    console.warn(e);
    return;
  }
  setStatus("● 运行中（camera · 本地推理）");
  camRunning = true;
  cameraLoop();
}

async function cameraLoop() {
  const video = els.sourceVideo;
  while (camRunning && state === "camera" && !benchActive) {
    if (video.readyState >= 2 && faceLmVideo) {
      try {
        const got = await detectCurrent(video, "video", performance.now());
        const frame = got.frame;
        frameCount++;
        if (frame) applyFrame(frame, { mirror: true });
        else {
          mesh.clear();
          readout.update([], {}); // 零值推进，轨道不冻结
        }
      } catch {
        // 时间戳回退等瞬时错误跳过这一帧
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/* ---------------- photo 模式（本地推理） ---------------- */
async function startPhoto(file) {
  if (!ready) {
    setStatus("推理引擎还在加载，稍候几秒再试…");
    return;
  }
  if (!(await ensureAvatarLoaded())) return;
  enterStage("photo");
  setStatus("分析照片中…（本地推理）");
  input.setPhoto(file);
  try {
    const bitmap = await createImageBitmap(file);
    const got = await detectCurrent(bitmap, "image");
    const frame = got.frame;
    if (!frame) {
      setStatus("没有检测到人脸，换一张试试");
      return;
    }
    applyFrame(frame, { snap: true });
    setStatus("photo · 本地推理完成");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

/* ---------------- video 模式（本地批处理 + 回放读数） ---------------- */
async function startVideo(file) {
  if (!ready) {
    setStatus("推理引擎还在加载，稍候几秒再试…");
    return;
  }
  if (!(await ensureAvatarLoaded())) return;
  enterStage("video");
  input.setVideo(file);
  const video = els.sourceVideo;
  await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  setStatus("本地逐帧处理中…");
  const frames = await perception.processVideo(video, faceLmVideo, (done, total) => {
    setStatus(`本地逐帧处理中… ${done}/${total}`);
  }, 66, { detectFrame: detectCurrent });
  videoFrames = [];
  for (const item of frames) {
    if (item.ok && item.blendshapes) {
      item.scores = buildScores(item);
      videoFrames.push(item);
    }
  }
  setStatus(`video · 已处理 ${videoFrames.length} 帧 · 播放即同步`);
}

function onVideoTime() {
  if (state !== "video" || !videoFrames.length) return;
  const t = els.sourceVideo.currentTime * 1000;
  let lo = 0, hi = videoFrames.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (videoFrames[mid].timestampMs <= t) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best >= 0 && t - videoFrames[best].timestampMs < 600) {
    applyFrame(videoFrames[best], { advanceReadout: false, snap: true });
  }
  readout.renderPlayback(videoFrames, t); // 读数轴跟随视频进度（可回拖）
}

/* ---------------- 感知模型下拉（客户端切换；蒸馏 ONNX 二期加入） ---------------- */
async function onModelChange() {
  const name = els.modelSelect.value;
  if (name === activeModelName) return;
  els.modelSelect.disabled = true;
  setStatus(`正在切换模型：${name}…`);
  try {
    const { blob } = await ensureModel(name);
    const buf = await blobToBuffer(blob);
    const opts = { outputBlendshapes: variantConfig.mediapipeBlendshapes };
    const nv = await perception.createFaceLandmarker(buf, "VIDEO", opts);
    const ni = await perception.createFaceLandmarker(buf, "IMAGE", opts);
    faceLmVideo?.close();
    faceLmImage?.close();
    faceLmVideo = nv;
    faceLmImage = ni;
    activeModelName = name;
    setStatus(`模型已切换：${name}`);
  } catch (e) {
    setStatus(String(e.message || e));
    els.modelSelect.value = activeModelName;
  } finally {
    els.modelSelect.disabled = false;
  }
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  els.btnCamera.addEventListener("click", startCamera);
  els.btnBrowse.addEventListener("click", () => els.fileInput.click());
  els.btnSecondary.addEventListener("click", () => els.fileInput.click());
  els.stopBtn.addEventListener("click", backToLanding);
  els.modelSelect.addEventListener("change", onModelChange);
  window.addEventListener("resize", () => gnmBackend?.resize?.());
  document.querySelectorAll("[data-avatar-backend]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.avatarBackend === "gnm") selectGnm();
      else selectVrm();
    });
  });
  els.faceModeSelect.addEventListener("change", () => {
    faceMode = els.faceModeSelect.value === "custom" ? "custom" : "preset";
    localStorage.setItem("dash.faceMode", faceMode);
    avatar?.setFaceMode(faceMode);
    setStatus(faceMode === "custom"
      ? "面部映射：custom（实验）"
      : "面部映射：preset");
  });
  els.avatarSelect.addEventListener("change", onAvatarChange);
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
  els.sourceVideo.addEventListener("timeupdate", onVideoTime);
  els.sourceImage.addEventListener("load", () => mesh.fitTo(els.sourceImage));
  window.addEventListener("resize", () => mesh.fitTo(input.activeMedia()));
  els.overlayBtn.addEventListener("click", () => location.reload());
}

function routeFile(file) {
  if (file.type.startsWith("image/")) startPhoto(file);
  else if (file.type.startsWith("video/")) startVideo(file);
  else setStatus("这不是照片或视频文件");
}

/* ---------------- 周期任务：FPS 与无人脸检测 ---------------- */
setInterval(() => {
  if (state !== "camera") return;
  els.fps.textContent = `● ${(frameCount / 2).toFixed(0)} FPS`;
  frameCount = 0;
  if (performance.now() - lastFacePresentAt > 800 && lastFacePresentAt > 0) {
    els.nofaceBadge.hidden = false;
  }
}, 2000);

/* ---------------- 入场动效（§6.5：被钉上板的感觉） ---------------- */
function entrance() {
  if (!window.gsap) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from("#statusbar", { y: -30, autoAlpha: 0, duration: 0.48 })
    .from("#input-card", { y: 40, autoAlpha: 0, rotation: -1.2, duration: 0.6 }, "-=0.2")
    .from("#output-card", { y: 40, autoAlpha: 0, rotation: 1.1, duration: 0.6 }, "-=0.45")
    .from("#strip", { y: 24, autoAlpha: 0, duration: 0.5 }, "-=0.35")
    .from(".pushpin", { scale: 0, duration: 0.35, ease: "back.out(3)", stagger: 0.08 }, "-=0.2")
    .from(".link-card", { y: 16, autoAlpha: 0, stagger: 0.08, duration: 0.4 }, "-=0.3")
    .from(".rail-box", { autoAlpha: 0, y: -8, stagger: 0.1, duration: 0.35 }, "-=0.2");
  // 后台标签页里 rAF 冻结会导致入场停在透明态：超时后清掉动画内联样式兜底
  setTimeout(() => {
    gsap.set("#statusbar, #input-card, #output-card, #strip, .pushpin, .link-card, .rail-box",
             { clearProps: "all" });
  }, 3000);
}

/* ---------------- 启动 ---------------- */
function updateAvatarBackendUi(mode) {
  avatarBackend = mode;
  document.querySelectorAll("[data-avatar-backend]").forEach((btn) => {
    const active = btn.dataset.avatarBackend === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.body.classList.toggle("gnm-mode", mode === "gnm");
  const sub = document.getElementById("avatar-idle-sub");
  if (sub) sub.textContent = mode === "gnm" ? "GNM · 3DMM" : "VRM · 52 BLENDSHAPE";
  const idle = document.getElementById("render-idle");
  if (idle) idle.hidden = !!(avatarManager?.ready || (mode === "gnm" && gnmBackend?.ready));
}

function selectVrm() {
  gnmLoadToken += 1;
  gnmLoadController?.abort();
  gnmLoadController = null;
  gnmLoading = false;
  const gnmButton = document.querySelector('[data-avatar-backend="gnm"]');
  if (gnmButton) gnmButton.disabled = false;
  gnmBackend?.cancelIdentityCapture?.();
  if (avatarBackend === "gnm") gnmBackend?.deactivate?.();
  avatar?.setRenderingEnabled(true);
  avatarManager?.setActive("vrm");
  updateAvatarBackendUi("vrm");
  setAvatarProgress(null);
  setAvatarError("");
  setStatus("动漫虚拟人 · VRM");
}

function fallbackToVrm(message) {
  const text = message ? `GNM 不可用：${message}` : "GNM 不可用，已回退 VRM";
  selectVrm();
  setAvatarError(text);
  setStatus(text);
}

async function selectGnm() {
  if (gnmLoading || avatarBackend === "gnm") return;
  if (gnmBackend?.ready) {
    try {
      avatarManager.register("gnm", gnmBackend);
      gnmBackend.activate();
      if (lastFaceFrame) gnmBackend.update(lastFaceFrame, { mirror: state === "camera" });
      await avatarManager.setActive("gnm");
      updateAvatarBackendUi("gnm");
      setAvatarError("");
      setAvatarProgress(null);
      setStatus("数字模拟人 · GNM");
    } catch (error) {
      fallbackToVrm(error?.message || String(error));
    }
    return;
  }

  if (!gnmBackend) gnmBackend = new GnmBackend(avatar);
  const token = ++gnmLoadToken;
  gnmLoadController = new AbortController();
  gnmLoading = true;
  const gnmButton = document.querySelector('[data-avatar-backend="gnm"]');
  if (gnmButton) gnmButton.disabled = true;
  setAvatarError("");
  setStatus("正在加载 GNM 资产…");
  setAvatarProgress(0, "加载 GNM 资产…");

  try {
    if (!gnmBackend.model) {
      await gnmBackend.init({
        signal: gnmLoadController.signal,
        onProgress: (p) => {
          if (token !== gnmLoadToken) return;
          if (p.phase === "download") {
            setAvatarProgress(p.fraction * 100, `下载 GNM 资产… ${Math.round(p.fraction * 100)}%`);
          } else if (p.phase === "verify") {
            setAvatarProgress(100, "校验 GNM 资产…");
          } else if (p.phase === "done") {
            setAvatarProgress(100, "GNM 资产已就绪");
          }
        },
      });
    }
    if (token !== gnmLoadToken) return;

    setStatus("请保持中性表情约 1.5 秒…");
    setAvatarProgress(null, "请保持中性表情约 1.5 秒…");
    const fitPromise = gnmBackend.startIdentityCapture({ durationMs: 1500 });
    if (lastFaceFrame) gnmBackend.captureFrame(lastFaceFrame);
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("identity fit 超时；请打开摄像头或选择照片/视频")), 8000);
    });
    try {
      await Promise.race([fitPromise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (token !== gnmLoadToken) return;
    avatarManager.register("gnm", gnmBackend);
    gnmBackend.activate();
    if (lastFaceFrame) gnmBackend.update(lastFaceFrame, { mirror: state === "camera" });
    await avatarManager.setActive("gnm");
    updateAvatarBackendUi("gnm");
    requestAnimationFrame(() => gnmBackend?.render());
    setAvatarError("");
    setAvatarProgress(null);
    setStatus("数字模拟人 · GNM");
  } catch (error) {
    if (token === gnmLoadToken && error?.name !== "AbortError") {
      gnmBackend?.cancelIdentityCapture?.();
      fallbackToVrm(error?.message || String(error));
    }
  } finally {
    if (token === gnmLoadToken) {
      gnmLoading = false;
      if (gnmButton) gnmButton.disabled = false;
      gnmLoadController = null;
      if (avatarBackend !== "gnm") setAvatarProgress(null, null);
    }
  }
}

function setBenchMode(next) {
  if (benchMode === "standard" && next !== "standard") collectPanel?.abort();
  if (benchMode === "quick" && next === "standard") bench?.abort();
  benchMode = next === "standard" ? "standard" : "quick";
  const standard = benchMode === "standard";
  document.body.classList.toggle("bench-standard", standard);
  document.querySelectorAll("[data-bench-mode]").forEach((btn) => {
    const on = btn.dataset.benchMode === benchMode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  const quickPanel = $("bench-panel-quick");
  const standardPanel = $("collect-card");
  if (quickPanel) quickPanel.hidden = standard;
  if (standardPanel) standardPanel.hidden = !standard;
  if (standard) {
    activeAvatarName = "vrm-girl";
    if (els.avatarSelect) els.avatarSelect.value = activeAvatarName;
    avatar?.setView("half");
    ensureAvatarLoaded().then((ok) => {
      if (!ok) setStatus("标准测试：数字虚拟人加载失败");
    });
  } else {
    const savedView = localStorage.getItem("dash.view");
    if (savedView && MODE_VIEWS[mode].includes(savedView)) avatar?.setView(savedView);
  }
}

function setupBenchTabs() {
  document.querySelectorAll("[data-bench-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setBenchMode(btn.dataset.benchMode));
  });
  setBenchMode(collectMode ? "standard" : "quick");
}

async function boot() {
  bindEvents();
  const savedFaceMode = localStorage.getItem("dash.faceMode");
  faceMode = savedFaceMode === "custom" ? "custom" : "preset";
  els.faceModeSelect.value = faceMode;
  entrance();
  // A 版本只显示「面部」视角（B 版本二期开放后恢复三档）
  document.querySelectorAll(".view-btn").forEach((b) => {
    b.hidden = !MODE_VIEWS[mode].includes(b.dataset.view);
  });
  try {
    avatar = new Avatar($("avatar-canvas"));
    vrmBackend = new VrmBackend(avatar);
    avatarManager = new AvatarManager({ backends: { vrm: vrmBackend } });
    avatarManager.setActive("vrm");
    updateAvatarBackendUi("vrm");
    avatar.setFaceMode(faceMode, { reapply: false });
  } catch {
    showOverlay("这个浏览器不支持 WebGL，换 Chrome / Edge 试试", false);
    return;
  }
  bench = createBenchmarkPanel({
    ensureAvatar: ensureAvatarLoaded,
    getDetect: () => detectCurrent,
    getVariant: () => variantConfig,
    getRuntime: () => variantRuntime,
    // benchmark 只驱动数字虚拟人，不干扰 ZONE 01 的网格 / 读数
    applyFrame: (frame, opts = {}) => {
      if (!frame) return;
      if (frame.blendshapes) avatar.setBlendshapes(frame.blendshapes, opts);
      if (frame.headEuler) avatar.setHeadEuler(frame.headEuler, opts);
    },
    getLandmarker: () => faceLmVideo,
    getAvatar: () => avatarManager || avatar,
    getInfo: () => {
      const model = manifestCache?.models?.find((m) => m.name === activeModelName);
      const av = avatarEntries.find((e) => e.name === activeAvatarName);
      return {
        model: { name: activeModelName, version: model?.version || "unknown" },
        avatar: { name: activeAvatarName, version: av?.version || "unknown" },
      };
    },
    getActiveCamera: () => (state === "camera" && els.sourceVideo.readyState >= 2
      ? { video: els.sourceVideo }
      : null),
    onStart: () => { benchActive = true; },
    onEnd: () => {
      benchActive = false;
      if (camRunning && state === "camera") cameraLoop();
    },
  });
  collectPanel = startCollectMode({
    getLandmarker: () => faceLmVideo,
    getAvatar: () => avatarManager || avatar,
    detectFrame: detectCurrent,
    variant: variantConfig,
    getRuntime: () => variantRuntime,
    applyFrame: (frame) => {
      if (!frame) return;
      avatarManager?.update(frame, { snap: true });
    },
    getInfo: () => {
      const model = manifestCache?.models?.find((m) => m.name === activeModelName);
      const av = avatarEntries.find((e) => e.name === activeAvatarName);
      return {
        model: { name: activeModelName, version: model?.version || "unknown" },
        avatar: { name: activeAvatarName, version: av?.version || "unknown" },
      };
    },
    seconds: collectSeconds,
    label: collectLabel,
    frontendVersion: "v26",
  });
  setupBenchTabs();

  // 模型就绪：IndexedDB 有缓存则零网络，否则带进度下载
  setStatus("首次加载推理引擎（wasm 约 13MB，仅第一次慢）…");
  let modelCacheHit = false;
  try {
    const { blob, fromCache } = await ensureModel("face_landmarker", (recv, total) => {
      setStatus(`首次下载模型中… ${Math.round(recv / 1024)}KB / ${Math.round((total || 0) / 1024)}KB`);
    });
    modelCacheHit = fromCache;
    const buf = await blobToBuffer(blob);
    const lmOptions = { outputBlendshapes: variantConfig.mediapipeBlendshapes };
    faceLmVideo = await perception.createFaceLandmarker(buf, "VIDEO", lmOptions);
    faceLmImage = await perception.createFaceLandmarker(buf, "IMAGE", lmOptions);
    ready = true;
    setStatus(fromCache ? "待机（模型来自本地缓存）" : "待机（模型已更新）");
  } catch (e) {
    showOverlay(`模型没加载成功：${e.message || e}`, true);
    return;
  }
  await refreshModels();
  if (variantConfig.modelUrl) {
    setStatus(`加载 ${variantConfig.label} 的 ONNX 模型…`);
    try {
      variantRuntime = await perception.loadOnnxVariant(variantConfig);
    } catch (e) {
      showOverlay(`感知变体加载失败：${e.message || e}`, true);
      return;
    }
  }
  setStatus(`待机（${modelCacheHit ? "模型来自本地缓存" : "模型已更新"} · 数字虚拟人按需加载${variantConfig.key !== "mp_full" ? ` · ${variantConfig.label}` : ""}）`);
  bench?.setReady(true);

  collectPanel?.setReady(true);
  if (benchMode === "standard") {
    activeAvatarName = "vrm-girl";
    els.avatarSelect.value = activeAvatarName;
    avatar.setView("half");
    const ok = await ensureAvatarLoaded();
    if (!ok) setStatus("标准测试：数字虚拟人加载失败");
  } else {
    const savedView = localStorage.getItem("dash.view");
    if (savedView && MODE_VIEWS[mode].includes(savedView)) {
      avatar.setView(savedView);
      document.querySelectorAll(".view-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.view === savedView)
      );
    }
  }
}

boot();
