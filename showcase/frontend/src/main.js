// 状态机与组装：landing / stage(camera|photo|video)
// 感知全部在浏览器本地（MediaPipe Tasks JS），服务器只是静态托管 + 模型分发。
import { Avatar } from "./avatar.js?v=9";
import { MeshOverlay } from "./mesh.js?v=9";
import { Readout, GROUPS_A, GROUPS_B } from "./readout.js?v=9";
import { SourceInput } from "./input.js?v=9";
import { poseMetrics, handMetrics } from "./metrics.js?v=9";
import { ensureEntry, fetchManifest, modelKind } from "./modelstore.js?v=9";
import { createBenchmarkPanel } from "./benchmark.js?v=9";
import { createAdapter } from "./adapters/registry.js?v=9";
import { hasOutput, normalizeBlendshapes } from "./adapters/adapter.js?v=9";
import { processVideo } from "./video/pipeline.js?v=9";

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
let activeAdapter = null;
let activeModelName = "face_landmarker";
let availableModels = [];
let videoAbort = null;
let videoRunId = 0;
let processing = false;

// 皮套人：manifest 条目 + 懒加载（首次需要时才下载/解析）
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

// 版本：A 面部（当前）；B 全身（二期，按钮置灰）
const MODE_VIEWS = { a: ["head"], b: ["head", "half", "full"] };
let mode = "a";

const input = new SourceInput({ box: els.sourceBox, image: els.sourceImage, video: els.sourceVideo });
const mesh = new MeshOverlay(els.meshCanvas);
const readout = new Readout(els.readoutEl);
let avatar = null;

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

/* ---------------- 皮套人：manifest 下拉 + 懒加载 + 进度 ---------------- */

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
async function refreshModels(manifest) {
  try {
    manifest = manifest || await fetchManifest();
    manifestCache = manifest;
  } catch {
    manifest = { models: [FALLBACK_AVATAR] };
    manifestCache = manifest;
    setAvatarError("manifest 读取失败，皮套人使用内置默认条目");
  }

  const perceptions = manifest.models.filter((m) => modelKind(m) === "perception");
  availableModels = perceptions;
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

// 真正需要驱动/显示皮套人时再加载；并发调用共享同一个 Promise
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
        const text = pct == null ? `下载皮套人 ${size}` : `下载皮套人 ${pct}% · ${size}`;
        setAvatarProgress(pct, text);
        setStatus(text);
      });
      setAvatarProgress(null, "解析皮套人模型…");
      setStatus("解析皮套人模型…");
      await avatar.loadFromBlob(blob);
      loadedAvatarName = entry.name;
      els.renderIdle.hidden = true;
      setAvatarProgress(null, null);
      setStatus(`皮套人就绪：${entryLabel(entry)}${fromCache ? "（本地缓存）" : ""}`);
      return true;
    } catch (e) {
      const raw = String(e.message || e);
      const msg = /Failed to fetch|NetworkError|Load failed/i.test(raw)
        ? `网络错误，未能下载 ${entryLabel(entry)}`
        : raw;
      setAvatarProgress(null, null);
      setAvatarError(`皮套人加载失败：${msg}（继续使用当前模型）`);
      setStatus(`皮套人加载失败：${msg}`);
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

function setBusy(busy) {
  els.btnCamera.disabled = busy;
  els.btnBrowse.disabled = busy;
  els.btnSecondary.disabled = busy;
  els.fileInput.disabled = busy;
  els.modelSelect.disabled = busy || availableModels.length < 2;
}

async function closeAdapter(adapter) {
  try {
    await adapter?.close();
  } catch {}
}

async function initAdapter(entry, options) {
  const adapter = await createAdapter(entry);
  try {
    const result = await adapter.init(options);
    return { adapter, result };
  } catch (error) {
    await closeAdapter(adapter);
    throw error;
  }
}

function mediaPipeEntry(models) {
  return models.find((m) => m.kind === "mediapipe-task" || m.name === "face_landmarker");
}

async function initDefaultAdapter(manifest, options) {
  const models = (manifest.models || []).filter((m) => modelKind(m) === "perception");
  const preferred = models.find((m) => m.default) || models[0];
  if (!preferred) throw new Error("manifest 中没有模型");
  try {
    return { entry: preferred, fallback: false, ...(await initAdapter(preferred, options)) };
  } catch (error) {
    const fallback = mediaPipeEntry(models);
    if (!fallback || fallback === preferred) throw error;
    return { entry: fallback, fallback: true, ...(await initAdapter(fallback, options)) };
  }
}

function resetOutputState() {
  videoFrames = [];
  mesh.clear();
  readout.reset();
  avatar?.resetPose();
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

function applyFrame(frame, { advanceReadout = true, mirror = false } = {}) {
  const blendshapes = normalizeBlendshapes(frame.blendshapes);
  const hasBlendshapes = !!(blendshapes && blendshapes.length > 0);
  const facePresent = hasOutput(frame);
  if (facePresent) {
    lastFacePresentAt = performance.now();
    els.nofaceBadge.hidden = true;
    avatar.setBlendshapes(hasBlendshapes ? blendshapes : [], { mirror });
    if (frame.headEuler) avatar.setHeadEuler(frame.headEuler, { mirror });
    els.renderIdle.hidden = true;
  }
  if (frame.landmarks && activeAdapter?.capabilities?.mesh === true) {
    mesh.draw(flatLandmarks(frame.landmarks));
  } else {
    mesh.clear();
  }
  if (advanceReadout) {
    if (hasBlendshapes) {
      readout.clearUnavailable();
      readout.update(blendshapes, {});
    } else {
      readout.update([], {});
      readout.setUnavailable("该模型无表情输出");
    }
  }
}

// 预计算一帧的读数分（视频回放模式用：读数跟随视频进度而非墙钟）
function buildScores(frame) {
  const scores = {};
  const blendshapes = normalizeBlendshapes(frame.blendshapes);
  if (blendshapes) for (const c of blendshapes) scores[c.categoryName] = c.score;
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
  videoAbort?.abort();
  videoAbort = null;
  videoRunId++;
  processing = false;
  setBusy(false);
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
    if (video.readyState >= 2 && activeAdapter) {
      try {
        const frame = await activeAdapter.infer(video, performance.now());
        frameCount++;
        if (frame && hasOutput(frame)) applyFrame(frame, { mirror: true });
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
    const frame = await activeAdapter.infer(bitmap, 0);
    if (!frame || !hasOutput(frame)) {
      setStatus("没有检测到人脸，换一张试试");
      return;
    }
    applyFrame(frame);
    setStatus("photo · 本地推理完成");
  } catch (e) {
    setStatus(String(e.message || e));
  }
}

/* ---------------- video 模式（本地批处理 + 回放读数） ---------------- */
function waitForMetadata(video, signal) {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
    };

    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("视频无法读取"));
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      cleanup();
      reject(new Error("视频元数据加载超时"));
    }, 10000);
  });
}

async function startVideo(file) {
  if (!ready) {
    setStatus("推理引擎还在加载，稍候几秒再试…");
    return;
  }
  if (!(await ensureAvatarLoaded())) return;

  const runId = ++videoRunId;
  videoAbort?.abort();
  const controller = new AbortController();
  videoAbort = controller;
  processing = true;
  setBusy(true);

  enterStage("video");
  videoFrames = [];
  input.setVideo(file);
  const video = els.sourceVideo;

  try {
    await waitForMetadata(video, controller.signal);
    if (runId !== videoRunId) return;

    setStatus("本地逐帧处理中…");
    const frames = await processVideo(video, activeAdapter, {
      strideMs: 66,
      signal: controller.signal,
      onProgress: (done, total) => {
        if (runId === videoRunId) setStatus(`本地逐帧处理中… ${done}/${total}`);
      },
    });
    if (runId !== videoRunId) return;

    videoFrames = [];
    for (const item of frames) {
      if (item.ok && hasOutput(item)) {
        item.scores = buildScores(item);
        videoFrames.push(item);
      }
    }
    setStatus(`video · 已处理 ${videoFrames.length} 帧 · 播放即同步`);
  } catch (e) {
    if (e.name !== "AbortError" && runId === videoRunId) {
      setStatus(`视频处理失败：${e.message || e}`);
    }
  } finally {
    if (runId === videoRunId) {
      processing = false;
      videoAbort = null;
      setBusy(false);
    }
  }
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
    applyFrame(videoFrames[best], { advanceReadout: false });
  }
  readout.renderPlayback(videoFrames, t); // 读数轴跟随视频进度（可回拖）
}

/* ---------------- 感知模型下拉（客户端切换；蒸馏 ONNX 二期加入） ---------------- */
async function onModelChange() {
  const name = els.modelSelect.value;
  if (name === activeModelName) return;
  if (processing) {
    els.modelSelect.value = activeModelName;
    setStatus("视频处理中，暂不能切换模型");
    return;
  }
  const entry = availableModels.find((m) => m.name === name);
  if (!entry) {
    setStatus(`未找到模型：${name}`);
    els.modelSelect.value = activeModelName;
    return;
  }
  setBusy(true);
  setStatus(`正在切换模型：${name}…`);
  let next = null;
  try {
    const initialized = await initAdapter(entry, {
      onProgress: (received, total) => {
        setStatus(`正在切换模型：${name}… ${Math.round(received / 1024)}KB / ${Math.round((total || 0) / 1024)}KB`);
      },
    });
    next = initialized.adapter;
    await closeAdapter(activeAdapter);
    activeAdapter = next;
    activeModelName = name;
    resetOutputState();
    setStatus(`模型已切换：${name}`);
  } catch (e) {
    await closeAdapter(next);
    const fallbackEntry = mediaPipeEntry(availableModels);
    if (fallbackEntry && fallbackEntry.name !== activeModelName) {
      try {
        const fallback = await initAdapter(fallbackEntry);
        await closeAdapter(activeAdapter);
        activeAdapter = fallback.adapter;
        activeModelName = fallback.entry.name;
        resetOutputState();
        setStatus(`模型切换失败，已回退 MediaPipe：${e.message || e}`);
      } catch {
        setStatus(`模型切换失败：${e.message || e}`);
      }
    } else {
      setStatus(String(e.message || e));
    }
    els.modelSelect.value = activeModelName;
  } finally {
    setBusy(false);
  }
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  els.btnCamera.addEventListener("click", startCamera);
  els.btnBrowse.addEventListener("click", () => els.fileInput.click());
  els.btnSecondary.addEventListener("click", () => els.fileInput.click());
  els.stopBtn.addEventListener("click", backToLanding);
  els.modelSelect.addEventListener("change", onModelChange);
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
  if (processing) {
    videoAbort?.abort();
    videoAbort = null;
    videoRunId++;
    processing = false;
    setBusy(false);
  }
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
async function boot() {
  bindEvents();
  entrance();
  // A 版本只显示「面部」视角（B 版本二期开放后恢复三档）
  document.querySelectorAll(".view-btn").forEach((b) => {
    b.hidden = !MODE_VIEWS[mode].includes(b.dataset.view);
  });
  try {
    avatar = new Avatar($("avatar-canvas"));
  } catch {
    showOverlay("这个浏览器不支持 WebGL，换 Chrome / Edge 试试", false);
    return;
  }
  bench = createBenchmarkPanel({
    ensureAvatar: ensureAvatarLoaded,
    // benchmark 只驱动皮套人，不干扰 ZONE 01 的网格 / 读数
    applyFrame: (frame, opts = {}) => {
      if (!frame) return;
      avatar.setBlendshapes(frame.blendshapes, opts);
      if (frame.headEuler) avatar.setHeadEuler(frame.headEuler, opts);
    },
    getLandmarker: () => activeAdapter,
    getAvatar: () => avatar,
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
  // 模型就绪：IndexedDB 有缓存则零网络，否则带进度下载
  setStatus("首次加载推理引擎（wasm 约 13MB，仅第一次慢）…");
  let modelCacheHit = false;
  try {
    const manifest = await fetchManifest();
    availableModels = manifest.models || [];
    const initialized = await initDefaultAdapter(manifest, {
      onProgress: (received, total) => {
        setStatus(`首次下载模型中… ${Math.round(received / 1024)}KB / ${Math.round((total || 0) / 1024)}KB`);
      },
    });
    activeAdapter = initialized.adapter;
    activeModelName = initialized.entry.name;
    const fromCache = initialized.result?.fromCache;
    modelCacheHit = !!fromCache;
    ready = true;
    setStatus(
      initialized.fallback
        ? "自定义模型初始化失败，已回退 MediaPipe"
        : fromCache
          ? "待机（模型来自本地缓存）"
          : "待机（模型已更新）",
    );
    await refreshModels(manifest);
  } catch (e) {
    await closeAdapter(activeAdapter);
    activeAdapter = null;
    showOverlay(`模型没加载成功：${e.message || e}`, true);
    return;
  }
  setStatus(`待机（${modelCacheHit ? "模型来自本地缓存" : "模型已更新"} · 皮套人按需加载）`);
  bench?.setReady(true);
  const savedView = localStorage.getItem("dash.view");
  if (savedView && MODE_VIEWS[mode].includes(savedView)) {
    avatar.setView(savedView);
    document.querySelectorAll(".view-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === savedView)
    );
  }
}

boot();
