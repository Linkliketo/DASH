// 性能测试：端到端 FPS / 感知推理 / rig+渲染 / 工作量长尾。
// 数据源只允许真实媒体（内置隐藏头像 / 本地图片 / 本地视频 / 摄像头），不做合成信号。
// 判定规则见 benchmark-rules.js：帧间隔受刷新率量化，只作诊断；判定以工作量与吞吐为准。
import {
  TARGET_FPS,
  FRAME_BUDGET_MS,
  LONG_TAIL_BUDGET_MS,
  WORK_OVER_BUDGET_WARN_RATIO,
  evaluateVerdict,
  verdictLabel,
} from "./benchmark-rules.js?v=26";

export const BENCH_SCHEMA = "dash.benchmark.v2";
export { TARGET_FPS, FRAME_BUDGET_MS };
const PROCESS_W = 640;
const PROCESS_H = 480;
const WARMUP_MS = 1000;

const BUILTIN_IMAGE_URL = "assets/img/bench-face.jpg";

/* ---------------- 统计工具 ---------------- */

function round(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function summarize(values, digits = 1) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) {
    return { mean: null, p50: null, p95: null, p99: null, max: null, min: null };
  }
  const sum = clean.reduce((a, b) => a + b, 0);
  return {
    mean: round(sum / clean.length, digits),
    p50: round(percentile(clean, 0.5), digits),
    p95: round(percentile(clean, 0.95), digits),
    p99: round(percentile(clean, 0.99), digits),
    max: round(clean[clean.length - 1], digits),
    min: round(clean[0], digits),
  };
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fileStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ---------------- 环境与能力探测 ---------------- */

function detectSimd() {
  try {
    // 标准 wasm SIMD 探测模块（i32x4.splat）
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
      10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch {
    return false;
  }
}

function webglRenderer() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "WebGL（renderer 信息不可用）";
  } catch {
    return null;
  }
}

function measureRefreshHz(timeoutMs = 700) {
  return new Promise((resolve) => {
    if (document.hidden) return resolve(null);
    const samples = [];
    let last = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (samples.length < 4) return resolve(null);
      const sorted = samples.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      resolve(med > 0 ? round(1000 / med, 0) : null);
    };
    const tick = (t) => {
      if (done) return;
      if (last) samples.push(t - last);
      last = t;
      if (samples.length >= 10) return finish();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(finish, timeoutMs);
  });
}

function collectEnvironment({ model, avatar, refreshHz }) {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || "",
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    devicePixelRatio: round(window.devicePixelRatio, 2),
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    webglRenderer: webglRenderer(),
    wasmSimd: detectSimd(),
    refreshHz,
    model,
    avatar,
  };
}

/* ---------------- 媒体源 ---------------- */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${url}`));
    img.src = url;
  });
}

function waitEvent(target, event, timeoutMs = 20000, signal) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const on = (e) => {
      cleanup();
      resolve(e);
    };
    const onAbort = () => {
      cleanup();
      reject(collectAbortError());
    };
    const cleanup = () => {
      target.removeEventListener(event, on);
      signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
    };
    target.addEventListener(event, on, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待 ${event} 超时`));
    }, timeoutMs);
  });
}

function waitFirstVideoFrame(video, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!video.requestVideoFrameCallback) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    video.requestVideoFrameCallback(finish);
    setTimeout(finish, timeoutMs);
  });
}

function coverRect(sw, sh, dw, dh) {
  if (!sw || !sh) return { x: 0, y: 0, w: dw, h: dh };
  const scale = Math.max(dw / sw, dh / sh);
  return {
    x: (dw - sw * scale) / 2,
    y: (dh - sh * scale) / 2,
    w: sw * scale,
    h: sh * scale,
  };
}

async function createSource(kind, file, { getActiveCamera, onStatus, srcUrl, videoEl, signal } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = PROCESS_W;
  canvas.height = PROCESS_H;
  const ctx = canvas.getContext("2d", { alpha: false });

  const base = {
    kind,
    label: "",
    width: null,
    height: null,
    processedWidth: PROCESS_W,
    processedHeight: PROCESS_H,
    loadMs: null,
    startupMs: null,
    nominalFps: null,
    captureFps: null,
    cameraUsed: kind === "camera",
    faceExpected: true,
    durationS: null,
    draw: null,
    reset: null,
    videoTimeMs: null,
    startCaptureCounter: () => null,
    cleanup: () => {},
  };

  if (kind === "builtin-image" || kind === "local-image") {
    let url = BUILTIN_IMAGE_URL;
    let revoke = null;
    if (kind === "local-image") {
      if (!file) throw new Error("请先选择一张图片");
      url = URL.createObjectURL(file);
      revoke = url;
    }
    const t0 = performance.now();
    const img = await loadImage(url);
    const loadMs = performance.now() - t0;
    if (kind === "local-image") onStatus?.(`图片已解码：${img.naturalWidth}×${img.naturalHeight}，${loadMs.toFixed(0)} ms`);
    return {
      ...base,
      label: kind === "builtin-image" ? "内置头像（隐藏输入）" : file.name,
      width: img.naturalWidth,
      height: img.naturalHeight,
      loadMs: round(loadMs),
      faceExpected: true,
      draw(now) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, PROCESS_W, PROCESS_H);
        // 轻微位移 + 缩放，让 tracker 持续工作；图片本身不进入 DOM
        const scale = 1 + 0.02 * Math.sin(now / 900);
        const rect = coverRect(img.naturalWidth, img.naturalHeight, PROCESS_W, PROCESS_H);
        const w = rect.w * scale;
        const h = rect.h * scale;
        const dx = rect.x + (PROCESS_W - w) / 2 + 4 * Math.sin(now / 700);
        const dy = rect.y + (PROCESS_H - h) / 2 + 3 * Math.cos(now / 1100);
        ctx.drawImage(img, dx, dy, w, h);
        return canvas;
      },
      startCaptureCounter: () => null,
      cleanup() {
        if (revoke) URL.revokeObjectURL(revoke);
      },
    };
  }

  if (kind === "local-video" || kind === "camera") {
    let video = null;
    let ownStream = null;
    let revoke = null;
    const t0 = performance.now();

    if (kind === "camera") {
      const active = getActiveCamera?.();
      if (active?.video && active.video.readyState >= 2) {
        video = active.video;
      } else {
        onStatus?.("正在打开摄像头…");
        ownStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = ownStream;
        await video.play();
        await waitFirstVideoFrame(video);
      }
    } else {
      if (!file) throw new Error("请先选择一段视频");
      revoke = URL.createObjectURL(file);
      video = videoEl || document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      if (!videoEl) {
        // 没有可见 preview 时，离屏但仍在 DOM 中
        video.style.cssText = "position:fixed;left:0;top:0;width:640px;height:360px;opacity:0.01;pointer-events:none;z-index:-1;";
        document.body.appendChild(video);
      }
      const onAbort = () => {
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch {}
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        video.src = srcUrl || revoke;
        await waitEvent(video, "loadedmetadata", 20000, signal);
        if (signal?.aborted) throw collectAbortError();
        await video.play();
        try {
          await waitEvent(video, "loadeddata", 3000, signal);
        } catch (e) {
          if (signal?.aborted) throw collectAbortError();
        }
        if (!video.videoWidth || video.readyState < 2) {
          await new Promise((resolve, reject) => {
            const started = performance.now();
            const check = () => {
              if (signal?.aborted) return reject(collectAbortError());
              if ((video.videoWidth && video.readyState >= 2) || performance.now() - started > 10000) resolve();
              else setTimeout(check, 1000);
            };
            check();
          });
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    }

    const startupMs = performance.now() - t0;
    let nominalFps = null;
    try {
      const track = kind === "camera" ? video.srcObject?.getVideoTracks?.()[0] : null;
      const rate = track?.getSettings?.().frameRate;
      if (rate) nominalFps = round(rate, 1);
    } catch {}

    return {
      ...base,
      label: kind === "camera" ? "摄像头" : file.name,
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      loadMs: kind === "camera" ? null : round(startupMs),
      startupMs: round(startupMs),
      nominalFps,
      durationS: kind === "camera" ? null : (Number.isFinite(video.duration) ? video.duration : null),
      faceExpected: true,
      reset: kind === "camera" ? null : async () => {
        video.pause();
        video.currentTime = 0;
        try {
          await waitEvent(video, "seeked", 500);
        } catch {}
        await video.play();
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
      videoTimeMs: () => video.currentTime * 1000,
      draw() {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, PROCESS_W, PROCESS_H);
        const rect = coverRect(video.videoWidth, video.videoHeight, PROCESS_W, PROCESS_H);
        ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);
        return canvas;
      },
      startCaptureCounter() {
        // 用 rVFC 统计媒体真实帧率；不支持时退到 getVideoPlaybackQuality
        if (video.requestVideoFrameCallback) {
          let frames = 0;
          let active = true;
          const cb = () => {
            if (!active) return;
            frames++;
            video.requestVideoFrameCallback(cb);
          };
          video.requestVideoFrameCallback(cb);
          return () => {
            active = false;
            return frames;
          };
        }
        const before = video.getVideoPlaybackQuality?.().totalVideoFrames ?? null;
        return () => {
          const after = video.getVideoPlaybackQuality?.().totalVideoFrames ?? null;
          return before == null || after == null ? null : after - before;
        };
      },
      cleanup() {
        if (ownStream) for (const track of ownStream.getTracks()) track.stop();
        if (kind === "local-video" && !videoEl) video.remove();
        if (revoke) URL.revokeObjectURL(revoke);
      },
    };
  }

  throw new Error(`未知的信号源：${kind}`);
}

/* ---------------- 测试运行器 ---------------- */

export class BenchmarkAbort extends Error {
  constructor(reason) {
    super(reason || "已中止");
    this.name = "BenchmarkAbort";
  }
}

export class BenchmarkRunner {
  constructor({ getLandmarker, applyFrame, ensureAvatar, getAvatar, getDetect, getVariant, getRuntime }) {
    this.getLandmarker = getLandmarker;
    this.applyFrame = applyFrame;
    this.ensureAvatar = ensureAvatar;
    this.getAvatar = getAvatar;
    this.getDetect = getDetect;
    this.getVariant = getVariant;
    this.getRuntime = getRuntime;
    this._abortReason = null;
    this._running = false;
    this._onVisibility = () => {
      if (document.hidden && this._running) this.abort("标签页切到后台，rAF 已冻结");
    };
  }

  abort(reason = "用户中止") {
    if (!this._running) return;
    this._abortReason = reason;
  }

  async run({ sourceKind, file, mode, value, getActiveCamera, getInfo, onStatus, onLive }) {
    if (this._running) throw new Error("已有测试在进行中");
    this._running = true;
    this._abortReason = null;
    document.addEventListener("visibilitychange", this._onVisibility);
    let source = null;
    const tSetup = performance.now();
    try {
      const landmarker = this.getLandmarker();
      if (!landmarker) throw new Error("推理引擎未就绪，请等状态栏显示「待机」");
      const detect = this.getDetect?.();
      if (!detect) throw new Error("感知变体未就绪");
      const variant = this.getVariant?.() || null;
      const runtime = this.getRuntime?.() || null;
      const avatar = this.getAvatar();
      if (!avatar) throw new Error("数字虚拟人渲染器未就绪");

      onStatus?.("加载数字虚拟人…");
      const avatarOk = await this.ensureAvatar();
      if (!avatarOk) throw new Error("数字虚拟人加载失败，无法开始测试");
      const avatarLoadMs = performance.now() - tSetup;
      if (this._abortReason) throw new BenchmarkAbort(this._abortReason);

      onStatus?.("加载测试媒体…");
      source = await createSource(sourceKind, file, { getActiveCamera, onStatus });
      if (this._abortReason) throw new BenchmarkAbort(this._abortReason);

      const durationMode = mode === "duration";
      const targetMs = durationMode ? Math.max(5, Number(value) || 30) * 1000 : null;
      const targetFrames = durationMode ? null : Math.max(30, Math.round(Number(value) || 300));
      // 两种模式都用时间预热：慢机器（软件渲染）也能在有限时间内进入测量
      const warmupMs = WARMUP_MS;

      onStatus?.("预热中（首帧不计入统计）…");
      const result = await this._loop({
        landmarker, detect, variant, runtime, avatar, source,
        durationMode, targetMs, targetFrames, warmupMs, getInfo, avatarLoadMs, onLive,
      });

      return result;
    } finally {
      this._running = false;
      this._abortReason = null;
      document.removeEventListener("visibilitychange", this._onVisibility);
      source?.cleanup?.();
    }
  }

  _loop({ landmarker, detect, variant, runtime, avatar, source, durationMode, targetMs, targetFrames, warmupMs, getInfo, avatarLoadMs, onLive }) {
    return new Promise((resolve, reject) => {
      const refreshPromise = measureRefreshHz();
      const intervals = [];
      const perception = [];
      const onnx = [];
      const mapping = [];
      const applyTimes = [];
      const rigTimes = [];
      const renderTimes = [];
      const pipeline = [];
      let loopStart = 0;
      let measuredStart = 0;
      let lastTick = 0;
      let lastTs = 0;
      let measuredFrames = 0;
      let detected = 0;
      let frameOverBudget = 0;
      let workOverBudget = 0;
      let warmupDone = false;
      let measureStarted = false;
      let renderedStart = 0;
      let stopCapture = null;
      let captureFrames = null;
      let liveAt = 0;

      const finish = async () => {
        const endedAt = performance.now();
        const elapsedMs = Math.max(1, endedAt - measuredStart);
        const renderedEnd = avatar.renderedFrames ?? 0;
        const fpsAvg = renderedStart ? (renderedEnd - renderedStart) / (elapsedMs / 1000) : null;
        if (stopCapture) captureFrames = stopCapture();
        source.captureFps = captureFrames == null
          ? null
          : round(captureFrames / (elapsedMs / 1000), 1);
        const refreshHz = await refreshPromise;

        const frameStats = summarize(intervals);
        const perceptionStats = summarize(perception);
        const onnxStats = summarize(onnx);
        const mappingStats = summarize(mapping);
        const applyStats = summarize(applyTimes);
        const rigStats = summarize(rigTimes);
        const renderStats = summarize(renderTimes);
        const rigRenderStats = summarize(rigTimes.map((v, i) => v + (renderTimes[i] ?? 0)));
        const pipelineStats = summarize(pipeline);
        const frameOverBudgetRatio = intervals.length ? frameOverBudget / intervals.length : null;
        const workOverBudgetRatio = pipeline.length ? workOverBudget / pipeline.length : null;
        const capacityFps = pipelineStats.mean ? 1000 / pipelineStats.mean : null;
        const p95CapacityFps = pipelineStats.p95 ? 1000 / pipelineStats.p95 : null;

        const verdict = evaluateVerdict({
          fpsAvg,
          meanWorkMs: pipelineStats.mean,
          p95WorkMs: pipelineStats.p95,
          workOverBudgetRatio,
          frameP95Ms: frameStats.p95,
          refreshHz,
        });

        const info = getInfo?.() ?? {};
        resolve({
          schema: BENCH_SCHEMA,
          generatedAt: new Date().toISOString(),
          generatedAtLocal: nowStamp(),
          config: {
            perceptionVariant: variant?.key || "mp_full",
            variantLabel: variant?.label || "MediaPipe Full",
            blendshapeSource: variant?.blendshapeSource || "mediapipe",
            modelSha256: runtime?.sha256 || variant?.modelSha256 || "",
            mediapipeBlendshapesEnabled: variant?.mediapipeBlendshapes !== false,
            ortProvider: runtime?.provider || variant?.ortProvider || "",
            modelLoadMs: runtime?.modelLoadMs ?? 0,
            mode: durationMode ? "duration" : "frames",
            targetDurationMs: durationMode ? targetMs : null,
            targetFrames: durationMode ? null : targetFrames,
            targetFps: TARGET_FPS,
            frameBudgetMs: round(FRAME_BUDGET_MS),
            longTailFactor: 1.2,
            longTailBudgetMs: round(LONG_TAIL_BUDGET_MS),
            workOverBudgetWarnRatio: WORK_OVER_BUDGET_WARN_RATIO,
            warmupMs,
            warmupFrames: null,
          },
          source: {
            kind: source.kind,
            label: source.label,
            cameraUsed: !!source.cameraUsed,
            width: source.width,
            height: source.height,
            processedWidth: source.processedWidth,
            processedHeight: source.processedHeight,
            loadMs: source.loadMs,
            startupMs: source.startupMs,
            nominalFps: source.nominalFps,
            captureFps: source.captureFps,
            faceDetectedRatio: measuredFrames ? round(detected / measuredFrames, 3) : null,
          },
          setup: {
            avatarLoadMs: round(avatarLoadMs),
            sourceLoadMs: source.loadMs,
            sourceStartupMs: source.startupMs,
          },
          environment: {
            ...collectEnvironment({ model: info.model, avatar: info.avatar, refreshHz }),
          },
          metrics: {
            frames: measuredFrames,
            elapsedMs: round(elapsedMs),
            fpsAvg: round(fpsAvg),
            capacityFps: round(capacityFps),
            p95CapacityFps: round(p95CapacityFps),
            frameMs: frameStats,
            perceptionMs: perceptionStats,
            onnxMs: onnxStats,
            mappingMs: mappingStats,
            applyMs: applyStats,
            rigRenderMs: {
              rig: rigStats,
              render: renderStats,
              total: rigRenderStats,
            },
            pipelineMs: pipelineStats,
            workOverBudgetFrames: workOverBudget,
            workOverBudgetRatio: workOverBudgetRatio == null ? null : round(workOverBudgetRatio, 3),
            frameIntervalOverBudgetFrames: frameOverBudget,
            frameIntervalOverBudgetRatio:
              frameOverBudgetRatio == null ? null : round(frameOverBudgetRatio, 3),
            droppedFrameRatio: frameOverBudgetRatio == null ? null : round(frameOverBudgetRatio, 3),
          },
          verdict,
        });
      };

      const step = async (now) => {
        if (this._abortReason) return reject(new BenchmarkAbort(this._abortReason));
        if (!loopStart) loopStart = now;
        if (lastTick && now - lastTick > 5000) {
          return reject(new BenchmarkAbort("检测到 rAF 冻结（标签页后台或主线程阻塞）"));
        }

        try {
          const frameSource = source.draw(now);
          let ts = Math.round(now);
          if (ts <= lastTs) ts = lastTs + 1;
          lastTs = ts;
          const t0 = performance.now();
          const got = await detect(frameSource, "video", ts);
          const t1 = performance.now();
          const frame = got.frame;
          const perceptionMs = got.perceptionMs ?? Math.max(0, t1 - t0 - (got.onnxMs || 0));
          const onnxMs = got.onnxMs || 0;
          if (this._abortReason) throw new BenchmarkAbort(this._abortReason);
          if (frame) this.applyFrame?.(frame, { mirror: !!source.cameraUsed, snap: !source.cameraUsed });
          const t2 = performance.now();
          const mappingMs = avatar.lastMappingMs || 0;
          const timing = avatar.lastTiming || { rigMs: 0, renderMs: 0 };
          const workMs = perceptionMs + onnxMs + mappingMs + timing.rigMs + timing.renderMs;

          if (warmupDone) {
            if (!measureStarted) {
              // 第一个测量帧只作为区间起点，避免把预热边界算进帧间隔
              measureStarted = true;
              measuredStart = now;
              renderedStart = avatar.renderedFrames ?? 0;
              stopCapture = source.startCaptureCounter?.() ?? null;
              lastTick = now;
              measuredFrames = 0;
              requestAnimationFrame(step);
              return;
            }
            const interval = now - lastTick;
            intervals.push(interval);
            if (interval > FRAME_BUDGET_MS) frameOverBudget++;
            if (workMs > FRAME_BUDGET_MS) workOverBudget++;
            perception.push(perceptionMs);
            onnx.push(onnxMs);
            mapping.push(mappingMs);
            applyTimes.push(t2 - t1);
            rigTimes.push(timing.rigMs);
            renderTimes.push(timing.renderMs);
            pipeline.push(workMs);
            measuredFrames++;
            if (frame) detected++;
          } else {
            const warm = now - loopStart >= warmupMs;
            if (warm) warmupDone = true;
          }

          lastTick = now;
          const nowMs = performance.now();
          if (nowMs - liveAt > 250) {
            liveAt = nowMs;
            const elapsed = warmupDone ? now - measuredStart : now - loopStart;
            const fps = warmupDone && measuredStart ? measuredFrames / ((now - measuredStart) / 1000) : null;
            onLive?.({
              warmup: !warmupDone,
              measuredFrames,
              elapsedMs: Math.max(0, elapsed),
              progress: warmupDone
                ? (durationMode
                    ? Math.min(1, (now - measuredStart) / targetMs)
                    : Math.min(1, measuredFrames / targetFrames))
                : 0,
              fps,
              perceptionMs: perception.length ? perception[perception.length - 1] : null,
              onnxMs: onnx.length ? onnx[onnx.length - 1] : null,
              mappingMs,
              rigRenderMs: timing.rigMs + timing.renderMs,
            });
          }

          if (warmupDone && measureStarted) {
            const done = durationMode
              ? now - measuredStart >= targetMs
              : measuredFrames >= targetFrames;
            if (done) {
              finish().then(resolve, reject);
              return;
            }
          }
          requestAnimationFrame(step);
        } catch (e) {
          reject(e);
        }
      };
      requestAnimationFrame(step);
    });
  }
}

/* ---------------- 结果格式化 ---------------- */

function fmt(v, unit = "") {
  if (v == null) return "—";
  return unit ? `${v} ${unit}` : String(v);
}

export function toMarkdown(r) {
  const src = r.source;
  const sourceLine = [
    src.label,
    `${fmt(src.width)}×${fmt(src.height)}`,
    `处理后 ${src.processedWidth}×${src.processedHeight}`,
    src.loadMs != null ? `加载 ${src.loadMs} ms` : null,
    src.startupMs != null && src.loadMs == null ? `启动 ${src.startupMs} ms` : null,
    src.captureFps != null ? `实测 ${src.captureFps} fps` : null,
    src.nominalFps != null ? `标称 ${src.nominalFps} fps` : null,
    `人脸检出率 ${src.faceDetectedRatio == null ? "—" : `${Math.round(src.faceDetectedRatio * 100)}%`}`,
    src.cameraUsed ? "摄像头已调用" : "未调用摄像头",
    "画面未上传",
  ].filter(Boolean).join("，");

  const config = r.config.mode === "duration"
    ? `${Math.round((r.config.targetDurationMs || 0) / 1000)} s（预热 ${r.config.warmupMs} ms）`
    : `${r.config.targetFrames} 帧（预热 ${r.config.warmupMs} ms）`;

  const rows = [
    ["平均帧率（端到端）", fmt(r.metrics.fpsAvg, "FPS"), `≥ ${r.config.targetFps} FPS`, checkMark(r.verdict.checks[0])],
    ["平均工作量", fmt(r.metrics.pipelineMs.mean, "ms"), `≤ ${r.config.frameBudgetMs} ms`, checkMark(r.verdict.checks[1])],
    ["P95 工作量", fmt(r.metrics.pipelineMs.p95, "ms"), `≤ ${r.config.longTailBudgetMs} ms`, checkMark(r.verdict.checks[2])],
    ["工作量超预算帧占比", fmt(r.metrics.workOverBudgetRatio == null ? null : round(r.metrics.workOverBudgetRatio * 100), "%"), "≤ 10% 告警线", "—"],
    ["帧间隔 P95（调度诊断）", fmt(r.metrics.frameMs.p95, "ms"), "—", "—"],
    ["调度间隔超预算占比", fmt(r.metrics.frameIntervalOverBudgetRatio == null ? null : round(r.metrics.frameIntervalOverBudgetRatio * 100), "%"), "诊断项", "—"],
    ["可持续帧率（均值 / P95 工作量）", `${fmt(r.metrics.capacityFps, "FPS")} / ${fmt(r.metrics.p95CapacityFps, "FPS")}`, "—", "—"],
    ["感知推理（MediaPipe）均值 / P95", `${fmt(r.metrics.perceptionMs.mean, "ms")} / ${fmt(r.metrics.perceptionMs.p95, "ms")}`, "—", "—"],
    ["ONNX 52 维回归 均值 / P95", `${fmt(r.metrics.onnxMs?.mean, "ms")} / ${fmt(r.metrics.onnxMs?.p95, "ms")}`, "—", "—"],
    ["VRM 映射 均值 / P95", `${fmt(r.metrics.mappingMs?.mean, "ms")} / ${fmt(r.metrics.mappingMs?.p95, "ms")}`, "—", "—"],
    ["rig+渲染 均值 / P95", `${fmt(r.metrics.rigRenderMs.rig.mean, "ms")} + ${fmt(r.metrics.rigRenderMs.render.mean, "ms")} / ${fmt(r.metrics.rigRenderMs.total.p95, "ms")}`, "—", "—"],
    ["流水线工作量 均值 / P95", `${fmt(r.metrics.pipelineMs.mean, "ms")} / ${fmt(r.metrics.pipelineMs.p95, "ms")}`, "—", "—"],
    ["统计帧数 / 时长", `${r.metrics.frames} 帧 / ${(r.metrics.elapsedMs / 1000).toFixed(1)} s`, "—", "—"],
    ["超预算帧数（工作量 / 调度间隔）", `${r.metrics.workOverBudgetFrames} / ${r.metrics.frameIntervalOverBudgetFrames}`, "—", "—"],
  ];

  const env = r.environment;
  const envRows = [
    ["数据来源", sourceLine],
    ["配置", config],
    ["UA", env.userAgent],
    ["CPU 逻辑核数", String(env.hardwareConcurrency ?? "—")],
    ["devicePixelRatio", String(env.devicePixelRatio ?? "—")],
    ["屏幕 / 视口", `${env.screen} / ${env.viewport}`],
    ["WebGL renderer", env.webglRenderer || "—"],
    ["WASM SIMD", env.wasmSimd ? "支持" : "不支持"],
    ["显示刷新率（估计）", env.refreshHz ? `${env.refreshHz} Hz` : "—"],
    ["摄像头调用", src.cameraUsed ? "已调用" : "未调用"],
    ["图像上传", "否（全程本地处理）"],
    ["感知模型", `${env.model?.name || "—"} ${env.model?.version || ""}`.trim()],
    ["感知变体", `${r.config.perceptionVariant || "mp_full"} / ${r.config.variantLabel || "MediaPipe Full"}`],
    ["52 维来源", r.config.blendshapeSource || "mediapipe"],
    ["MediaPipe blendshapes", r.config.mediapipeBlendshapesEnabled ? "开启" : "关闭"],
    ["ONNX 模型 SHA-256", r.config.modelSha256 || "—"],
    ["ONNX provider / 模型加载", `${r.config.ortProvider || "—"} / ${fmt(r.config.modelLoadMs, "ms")}`],
    ["数字虚拟人", `${env.avatar?.name || "—"} ${env.avatar?.version || ""}`.trim()],
  ];

  const verdictText = verdictLabel(r.verdict.level);
  const lines = [
    "## DASH 浏览器端性能测试",
    "",
    `- 时间：${r.generatedAtLocal}`,
    `- 数据来源：${sourceLine}`,
    `- 配置：${config}；目标 ${r.config.targetFps} FPS / ${r.config.frameBudgetMs} ms 工作量预算，长尾容忍 1.2×（${r.config.longTailBudgetMs} ms）`,
    `- 判定：**${verdictText}**`,
    "",
    "| 指标 | 实测 | 门限 | 判定 |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    ...(r.verdict.warnings.length || r.verdict.notes.length
      ? [
          "",
          "### 告警与口径说明",
          ...r.verdict.warnings.map((w) => `- 告警：${w}`),
          ...r.verdict.notes.map((n) => `- 说明：${n}`),
        ]
      : []),
    "",
    "### 环境",
    "",
    "| 项 | 值 |",
    "| --- | --- |",
    ...envRows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, "\\|")} |`),
    "",
    `> 口径：判定以「平均帧率 + 平均/P95 工作量」为准；帧间隔受显示刷新率量化，仅作调度诊断。感知耗时为 MediaPipe detectForVideo；ONNX 为 52 维回归；rig+渲染来自渲染循环埋点；工作量 = 感知 + ONNX + 表情映射 + rig + 渲染，不含测试页的 canvas 重采样。mapping_ms 是 VRM 映射耗时，不是 ONNX 延迟。`,
  ];
  return lines.join("\n");
}

function checkMark(check) {
  if (!check) return "—";
  return check.pass ? "通过" : "未通过";
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(r) {
  const rows = [["category", "metric", "value", "unit", "threshold", "pass"]];
  rows.push(["verdict", "level", r.verdict.level, "", "", r.verdict.pass]);
  for (const c of r.verdict.checks) {
    rows.push(["verdict", c.name, c.value, c.unit, c.threshold, c.pass]);
  }
  for (const w of r.verdict.warnings) rows.push(["warning", "message", w, "", "", ""]);
  for (const n of r.verdict.notes) rows.push(["note", "message", n, "", "", ""]);
  const m = r.metrics;
  const metricRows = [
    ["metrics", "frames", m.frames, "frames", "", ""],
    ["metrics", "elapsedMs", m.elapsedMs, "ms", "", ""],
    ["metrics", "fpsAvg", m.fpsAvg, "FPS", r.config.targetFps, m.fpsAvg >= r.config.targetFps],
    ["metrics", "capacityFps", m.capacityFps, "FPS", r.config.targetFps, ""],
    ["metrics", "p95CapacityFps", m.p95CapacityFps, "FPS", r.config.targetFps, ""],
    ["metrics", "pipelineMean", m.pipelineMs.mean, "ms", r.config.frameBudgetMs, ""],
    ["metrics", "pipelineP95", m.pipelineMs.p95, "ms", r.config.longTailBudgetMs, ""],
    ["metrics", "workOverBudgetFrames", m.workOverBudgetFrames, "frames", "", ""],
    ["metrics", "workOverBudgetRatio", m.workOverBudgetRatio, "ratio", r.config.workOverBudgetWarnRatio, ""],
    ["metrics", "frameMean", m.frameMs.mean, "ms", "", ""],
    ["metrics", "frameP95", m.frameMs.p95, "ms", "", ""],
    ["metrics", "frameP99", m.frameMs.p99, "ms", "", ""],
    ["metrics", "frameIntervalOverBudgetFrames", m.frameIntervalOverBudgetFrames, "frames", "", ""],
    ["metrics", "frameIntervalOverBudgetRatio", m.frameIntervalOverBudgetRatio, "ratio", "", ""],
    ["metrics", "perceptionMean", m.perceptionMs.mean, "ms", "", ""],
    ["metrics", "perceptionP95", m.perceptionMs.p95, "ms", "", ""],
    ["metrics", "onnxMean", m.onnxMs?.mean, "ms", "", ""],
    ["metrics", "onnxP95", m.onnxMs?.p95, "ms", "", ""],
    ["metrics", "mappingMean", m.mappingMs?.mean, "ms", "", ""],
    ["metrics", "mappingP95", m.mappingMs?.p95, "ms", "", ""],
    ["metrics", "rigMean", m.rigRenderMs.rig.mean, "ms", "", ""],
    ["metrics", "renderMean", m.rigRenderMs.render.mean, "ms", "", ""],
    ["metrics", "rigRenderP95", m.rigRenderMs.total.p95, "ms", "", ""],
  ];
  rows.push(...metricRows);
  const s = r.source;
  rows.push(
    ["config", "perceptionVariant", r.config.perceptionVariant, "", "", ""],
    ["config", "blendshapeSource", r.config.blendshapeSource, "", "", ""],
    ["config", "modelSha256", r.config.modelSha256, "", "", ""],
    ["config", "mediapipeBlendshapesEnabled", r.config.mediapipeBlendshapesEnabled, "", "", ""],
    ["config", "ortProvider", r.config.ortProvider, "", "", ""],
    ["config", "modelLoadMs", r.config.modelLoadMs, "ms", "", ""],
    ["source", "kind", s.kind, "", "", ""],
    ["source", "label", s.label, "", "", ""],
    ["source", "cameraUsed", s.cameraUsed, "", "", ""],
    ["source", "imageUploaded", false, "", "", ""],
    ["source", "width", s.width, "px", "", ""],
    ["source", "height", s.height, "px", "", ""],
    ["source", "processedWidth", s.processedWidth, "px", "", ""],
    ["source", "processedHeight", s.processedHeight, "px", "", ""],
    ["source", "loadMs", s.loadMs, "ms", "", ""],
    ["source", "startupMs", s.startupMs, "ms", "", ""],
    ["source", "nominalFps", s.nominalFps, "fps", "", ""],
    ["source", "captureFps", s.captureFps, "fps", "", ""],
    ["source", "faceDetectedRatio", s.faceDetectedRatio, "ratio", "", ""],
    ["environment", "userAgent", r.environment.userAgent, "", "", ""],
    ["environment", "hardwareConcurrency", r.environment.hardwareConcurrency, "", "", ""],
    ["environment", "devicePixelRatio", r.environment.devicePixelRatio, "", "", ""],
    ["environment", "wasmSimd", r.environment.wasmSimd, "", "", ""],
    ["environment", "webglRenderer", r.environment.webglRenderer, "", "", ""],
    ["environment", "refreshHz", r.environment.refreshHz, "Hz", "", ""],
    ["environment", "model", r.environment.model?.name, "", r.environment.model?.version, ""],
    ["environment", "avatar", r.environment.avatar?.name, "", r.environment.avatar?.version, ""],
  );
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function resultFilename(r, ext) {
  return `dash-benchmark-${r.config?.perceptionVariant || "mp_full"}-${fileStamp()}.${ext}`;
}

/* ---------------- 面板（DOM 绑定 + 导出） ---------------- */

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function createBenchmarkPanel({
  ensureAvatar, applyFrame, getLandmarker, getAvatar, getInfo, getActiveCamera,
  getDetect, getVariant, getRuntime, onStart, onEnd,
}) {
  const $ = (id) => document.getElementById(id);
  const els = {
    card: $("benchmark-card"),
    source: $("bench-source"),
    fileBtn: $("bench-file-btn"),
    file: $("bench-file"),
    fileName: $("bench-file-name"),
    mode: $("bench-mode"),
    value: $("bench-value"),
    unit: $("bench-unit"),
    start: $("bench-start"),
    abort: $("bench-abort"),
    status: $("bench-status"),
    live: $("bench-live"),
    liveFps: $("bench-live-fps"),
    livePerception: $("bench-live-perception"),
    liveRig: $("bench-live-rig"),
    liveFrames: $("bench-live-frames"),
    progress: $("bench-progress-bar"),
    privacy: $("bench-privacy"),
    result: $("bench-result"),
  };
  if (!els.card || !els.start) return { setReady() {} };

  let ready = false;
  let busy = false;
  let pendingFile = null;
  let lastResult = null;
  const runner = new BenchmarkRunner({
    getLandmarker, applyFrame, ensureAvatar, getAvatar,
    getDetect, getVariant, getRuntime,
  });

  function setStatus(text, kind = "") {
    els.status.textContent = text;
    els.status.dataset.kind = kind;
  }

  function syncPrivacy(text) {
    if (!els.privacy) return;
    if (text) {
      els.privacy.textContent = text;
      return;
    }
    els.privacy.textContent = els.source.value === "camera"
      ? "隐私：将调用摄像头；画面只在本机处理，不会上传。"
      : "隐私：未调用摄像头；画面只在本机处理，不会上传。";
  }

  function syncSourceUi() {
    const kind = els.source.value;
    const needFile = kind === "local-image" || kind === "local-video";
    els.fileBtn.hidden = !needFile;
    els.fileName.textContent = needFile
      ? (pendingFile ? `${pendingFile.name}（${(pendingFile.size / 1048576).toFixed(1)} MB）` : "未选择文件")
      : "";
    els.file.accept = kind === "local-image" ? "image/*" : kind === "local-video" ? "video/*" : "";
    els.start.disabled = busy || !ready;
  }

  function syncQuickTime() {
    const time = $("bench-quick-time");
    if (!time) return;
    const duration = els.mode.value === "duration";
    const value = Number(els.value.value) || (duration ? 30 : 300);
    const variant = getVariant?.();
    const suffix = variant && variant.key !== "mp_full" ? ` · ${variant.label}` : "";
    time.textContent = duration
      ? `快速测试${suffix}：约 ${Math.max(1, Math.round(value))} 秒（含前 1 s 预热）`
      : `快速测试${suffix}：约 ${Math.max(1, Math.round(value / 30 + 1))} 秒（按 30 FPS 估算，含预热）`;
  }

  function syncModeUi() {
    const duration = els.mode.value === "duration";
    els.unit.textContent = duration ? "s" : "帧";
    els.value.min = duration ? "5" : "30";
    els.value.max = duration ? "600" : "3000";
    els.value.value = duration ? "30" : "300";
    els.start.disabled = busy || !ready;
    syncQuickTime();
  }

  function setBusy(on) {
    busy = on;
    els.source.disabled = on;
    els.mode.disabled = on;
    els.value.disabled = on;
    els.fileBtn.disabled = on;
    els.start.hidden = on;
    els.abort.hidden = !on;
    if (!on) syncSourceUi();
  }

  function table(rows) {
    const t = document.createElement("table");
    t.className = "bench-table mono";
    for (const [k, v] of rows) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = k;
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(th, td);
      t.appendChild(tr);
    }
    return t;
  }

  function renderResult(r) {
    lastResult = r;
    els.result.hidden = false;
    els.result.innerHTML = "";

    const verdict = document.createElement("div");
    verdict.className = `bench-verdict ${r.verdict.level}`;
    const stamp = document.createElement("strong");
    stamp.textContent = verdictLabel(r.verdict.level);
    const summary = document.createElement("span");
    summary.className = "mono";
    summary.textContent = `${r.metrics.fpsAvg ?? "—"} FPS · 平均工作量 ${r.metrics.pipelineMs.mean ?? "—"} ms · P95 ${r.metrics.pipelineMs.p95 ?? "—"} ms · 超预算 ${r.metrics.workOverBudgetRatio == null ? "—" : round(r.metrics.workOverBudgetRatio * 100)}%`;
    verdict.append(stamp, summary);
    els.result.appendChild(verdict);

    const sourceP = document.createElement("p");
    sourceP.className = "bench-source mono";
    sourceP.textContent = `数据来源：${r.source.label} · ${r.source.width ?? "—"}×${r.source.height ?? "—"} → ${r.source.processedWidth}×${r.source.processedHeight} · 加载 ${r.source.loadMs ?? "—"} ms${r.source.startupMs != null ? ` · 启动 ${r.source.startupMs} ms` : ""}${r.source.captureFps != null ? ` · 实测 ${r.source.captureFps} fps` : ""}${r.source.nominalFps != null ? ` · 标称 ${r.source.nominalFps} fps` : ""} · 人脸检出 ${r.source.faceDetectedRatio == null ? "—" : `${Math.round(r.source.faceDetectedRatio * 100)}%`} · 摄像头 ${r.source.cameraUsed ? "已调用" : "未调用"} · 画面未上传`;
    els.result.appendChild(sourceP);

    if (r.source.faceDetectedRatio === 0) {
      const warn = document.createElement("p");
      warn.className = "bench-warn mono";
      warn.textContent = "警告：测试期间未检出人脸，感知耗时只代表检测阶段；建议换含人脸的图片/视频或使用摄像头复测。";
      els.result.appendChild(warn);
    }

    els.result.appendChild(table(r.verdict.checks.map((c) => [
      c.name,
      fmt(c.value, c.unit),
      c.pass ? "通过" : "未通过",
    ])));

    if (r.verdict.warnings.length || r.verdict.notes.length) {
      const ul = document.createElement("ul");
      ul.className = "bench-notes mono";
      for (const w of r.verdict.warnings) {
        const li = document.createElement("li");
        li.textContent = `告警：${w}`;
        ul.appendChild(li);
      }
      for (const n of r.verdict.notes) {
        const li = document.createElement("li");
        li.textContent = `说明：${n}`;
        ul.appendChild(li);
      }
      els.result.appendChild(ul);
    }

    const detail = document.createElement("details");
    detail.className = "bench-env";
    const summaryEl = document.createElement("summary");
    summaryEl.className = "mono";
    summaryEl.textContent = "详细指标与环境信息";
    detail.appendChild(summaryEl);
    detail.appendChild(table([
      ["平均帧率", fmt(r.metrics.fpsAvg, "FPS")],
      ["可持续帧率（均值 / P95 工作量）", `${fmt(r.metrics.capacityFps, "FPS")} / ${fmt(r.metrics.p95CapacityFps, "FPS")}`],
      ["工作量 均值 / P50 / P95 / P99", `${fmt(r.metrics.pipelineMs.mean)} / ${fmt(r.metrics.pipelineMs.p50)} / ${fmt(r.metrics.pipelineMs.p95)} / ${fmt(r.metrics.pipelineMs.p99)} ms`],
      ["工作量超预算帧", `${r.metrics.workOverBudgetFrames} 帧（${fmt(r.metrics.workOverBudgetRatio == null ? null : round(r.metrics.workOverBudgetRatio * 100), "%")}）`],
      ["调度间隔 均值 / P50 / P95 / P99", `${fmt(r.metrics.frameMs.mean)} / ${fmt(r.metrics.frameMs.p50)} / ${fmt(r.metrics.frameMs.p95)} / ${fmt(r.metrics.frameMs.p99)} ms`],
      ["调度间隔超预算帧", `${r.metrics.frameIntervalOverBudgetFrames} 帧（${fmt(r.metrics.frameIntervalOverBudgetRatio == null ? null : round(r.metrics.frameIntervalOverBudgetRatio * 100), "%")}）`],
      ["感知推理（MediaPipe）均值 / P95 / 最大", `${fmt(r.metrics.perceptionMs.mean)} / ${fmt(r.metrics.perceptionMs.p95)} / ${fmt(r.metrics.perceptionMs.max)} ms`],
      ["ONNX 52 维回归 均值 / P95", `${fmt(r.metrics.onnxMs?.mean)} / ${fmt(r.metrics.onnxMs?.p95)} ms`],
      ["VRM 映射 均值 / P95", `${fmt(r.metrics.mappingMs?.mean)} / ${fmt(r.metrics.mappingMs?.p95)} ms`],
      ["rig 均值 / 渲染均值", `${fmt(r.metrics.rigRenderMs.rig.mean)} / ${fmt(r.metrics.rigRenderMs.render.mean)} ms`],
      ["统计帧数 / 时长", `${r.metrics.frames} / ${(r.metrics.elapsedMs / 1000).toFixed(1)} s`],
      ["摄像头 / 图像上传", `${r.source.cameraUsed ? "已调用" : "未调用"} / 否`],
      ["数字虚拟人加载", `${fmt(r.setup.avatarLoadMs, "ms")}`],
      ["UA", r.environment.userAgent],
      ["CPU 核数 / DPR", `${r.environment.hardwareConcurrency ?? "—"} / ${r.environment.devicePixelRatio ?? "—"}`],
      ["屏幕 / 视口", `${r.environment.screen} / ${r.environment.viewport}`],
      ["WebGL renderer", r.environment.webglRenderer || "—"],
      ["WASM SIMD", r.environment.wasmSimd ? "支持" : "不支持"],
      ["显示刷新率（估计）", r.environment.refreshHz ? `${r.environment.refreshHz} Hz` : "—"],
      ["感知变体", `${r.config.perceptionVariant} / ${r.config.variantLabel}`],
      ["52 维来源 / MediaPipe blendshapes", `${r.config.blendshapeSource} / ${r.config.mediapipeBlendshapesEnabled ? "开启" : "关闭"}`],
      ["ONNX SHA-256 / provider / 加载", `${r.config.modelSha256 || "—"} / ${r.config.ortProvider || "—"} / ${fmt(r.config.modelLoadMs, "ms")}`],
      ["感知模型 / 数字虚拟人", `${r.environment.model?.name || "—"} ${r.environment.model?.version || ""} / ${r.environment.avatar?.name || "—"} ${r.environment.avatar?.version || ""}`],
      ["生成时间", r.generatedAtLocal],
    ]));
    els.result.appendChild(detail);

    const actions = document.createElement("div");
    actions.className = "bench-actions";
    const mk = (label, fn, primary) => {
      const b = document.createElement("button");
      b.className = `btn${primary ? " btn-primary" : ""}`;
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    actions.append(
      mk("复制 Markdown", async () => {
        const ok = await copyText(toMarkdown(r));
        setStatus(ok ? "Markdown 已复制" : "复制失败，请手动选择结果", ok ? "ok" : "err");
      }, true),
      mk("下载 JSON", () => download(resultFilename(r, "json"), JSON.stringify(r, null, 2), "application/json")),
      mk("下载 CSV", () => download(resultFilename(r, "csv"), toCsv(r), "text/csv;charset=utf-8")),
    );
    els.result.appendChild(actions);
  }

  function renderLive(s) {
    els.live.hidden = false;
    els.progress.style.transform = `scaleX(${Math.max(0, Math.min(1, s.progress || 0))})`;
    els.liveFps.textContent = s.fps == null ? "—" : s.fps.toFixed(1);
    els.livePerception.textContent = s.perceptionMs == null ? "—" : s.perceptionMs.toFixed(1);
    els.liveRig.textContent = s.rigRenderMs == null ? "—" : s.rigRenderMs.toFixed(1);
    els.liveFrames.textContent = s.warmup ? "预热" : `${s.measuredFrames} 帧 · ${(s.elapsedMs / 1000).toFixed(1)} s`;
  }

  async function start() {
    if (busy || !ready) return;
    const kind = els.source.value;
    if ((kind === "local-image" || kind === "local-video") && !pendingFile) {
      setStatus("请先选择测试文件", "err");
      return;
    }
    const mode = els.mode.value;
    const value = Number(els.value.value);
    if (!Number.isFinite(value) || value <= 0) {
      setStatus("请输入有效的时长或帧数", "err");
      return;
    }
    setBusy(true);
    setStatus("准备中…");
    syncPrivacy("隐私：测试进行中；画面只在本机处理，不会上传。");
    els.result.hidden = true;
    els.live.hidden = false;
    els.progress.style.transform = "scaleX(0)";
    onStart?.();
    let announcedMeasure = false;
    try {
      const result = await runner.run({
        sourceKind: kind === "builtin" ? "builtin-image" : kind,
        file: pendingFile,
        mode,
        value,
        getActiveCamera,
        getInfo,
        onStatus: (text) => setStatus(text),
        onLive: (live) => {
          renderLive(live);
          if (!live.warmup && !announcedMeasure) {
            announcedMeasure = true;
            setStatus("测量中…");
          }
        },
      });
      renderResult(result);
      syncPrivacy(result.source.cameraUsed
        ? "本次测试：已调用摄像头；未上传任何画面。"
        : "本次测试：未调用摄像头；未上传任何画面。");
      const levelClass = result.verdict.level === "fail" ? "err" : result.verdict.level === "warn" ? "warn" : "ok";
      setStatus(`完成：${verdictLabel(result.verdict.level)}`, levelClass);
    } catch (e) {
      if (e instanceof BenchmarkAbort) {
        setStatus(`已中止：${e.message}。本次结果无效。`, "err");
      } else {
        setStatus(`测试失败：${e.message || e}`, "err");
      }
      syncPrivacy("本次测试未完成；未上传任何画面。");
      els.live.hidden = true;
    } finally {
      setBusy(false);
      onEnd?.();
    }
  }

  els.source.addEventListener("change", () => {
    pendingFile = null;
    els.file.value = "";
    syncSourceUi();
    syncPrivacy();
  });
  els.fileBtn.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", () => {
    pendingFile = els.file.files[0] || null;
    syncSourceUi();
    if (pendingFile) setStatus(`已选择：${pendingFile.name}`);
  });
  els.mode.addEventListener("change", syncModeUi);
  els.value.addEventListener("input", syncQuickTime);
  els.start.addEventListener("click", start);
  els.abort.addEventListener("click", () => {
    runner.abort("用户中止");
    setStatus("正在中止…");
  });

  syncModeUi();
  syncSourceUi();
  syncPrivacy();

  return {
    setReady(on) {
      ready = !!on;
      els.start.disabled = busy || !ready;
      if (ready && !lastResult) setStatus("默认 30 s；丢弃前 1 s 预热；后台标签页会中止测试。");
    },
    abort: () => runner.abort("用户中止"),
  };
}

/* ================= 持续负载采集模式（?bench=collect） ================= */

export const COLLECT_SCHEMA = "dash.benchmark.collect.v2";
export const COLLECT_HEADER =
  "run_id,device_id,repeat_index,cache_state,timestamp_ms,video_time_ms,frame_index," +
  "perception_ms,onnx_ms,mapping_ms,rig_ms,render_ms,work_ms,frame_interval_ms," +
  "face_detected,over_budget_work,over_budget_interval,visibility_state," +
  "perception_variant,blendshape_source,model_sha256,mediapipe_blendshapes_enabled," +
  "avatar_backend,gnm_state,gnm_fallback,gnm_load_ms,gnm_identity_fit_ms," +
  "gnm_solve_ms,gnm_forward_ms,gnm_render_ms,gnm_frame_ms";

const COLLECT_VIDEO_URL = "assets/bench/single-face-30fps.mp4";
const COLLECT_REPEATS = 10;

function approxCollectLabel(seconds) {
  const total = Math.max(1, Number(seconds) || 30) * COLLECT_REPEATS + 10;
  if (total < 60) return `约 ${Math.max(1, Math.round(total))} 秒`;
  return `约 ${Math.max(1, Math.round(total / 60))} 分钟`;
}

function approxRemainingLabel(seconds) {
  const left = Math.max(1, Number(seconds) || 0);
  if (left >= 60) return `约剩 ${Math.ceil(left / 60)} 分钟`;
  return `约剩 ${Math.ceil(left)} 秒`;
}

const COLLECT_ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function collectZipCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ COLLECT_ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function collectZipDate(now = new Date()) {
  const time = ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    (Math.floor(now.getSeconds() / 2) & 0x1f);
  const date = (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);
  return { time, date };
}

function makeCollectZip(files) {
  const encoder = new TextEncoder();
  const { time, date } = collectZipDate();
  const entries = files.map((file) => {
    const nameBytes = encoder.encode(file.name);
    const bytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    return { nameBytes, bytes, crc: collectZipCrc32(bytes), offset: 0 };
  });
  const localParts = [];
  let offset = 0;
  for (const entry of entries) {
    entry.offset = offset;
    const header = new Uint8Array(30 + entry.nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, entry.crc, true);
    dv.setUint32(18, entry.bytes.length, true);
    dv.setUint32(22, entry.bytes.length, true);
    dv.setUint16(26, entry.nameBytes.length, true);
    dv.setUint16(28, 0, true);
    header.set(entry.nameBytes, 30);
    localParts.push(header, entry.bytes);
    offset += header.length + entry.bytes.length;
  }
  const centralParts = [];
  let centralSize = 0;
  for (const entry of entries) {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, entry.crc, true);
    dv.setUint32(20, entry.bytes.length, true);
    dv.setUint32(24, entry.bytes.length, true);
    dv.setUint16(28, entry.nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, entry.offset, true);
    header.set(entry.nameBytes, 46);
    centralParts.push(header);
    centralSize += header.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);
  dv.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}

function r3(v) {
  return (round(Number(v), 3) ?? 0);
}

function getCollectDeviceId() {
  const key = "dash.collect.deviceId";
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const id = crypto.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
}

async function sha256Hex(buffer) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function collectStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function collectRow(runId, deviceId, repeatIndex, cacheState, row) {
  return [
    runId,
    deviceId,
    repeatIndex,
    cacheState,
    row.timestamp_ms,
    row.video_time_ms,
    row.frame_index,
    r3(row.perception_ms),
    r3(row.onnx_ms),
    r3(row.mapping_ms),
    r3(row.rig_ms),
    r3(row.render_ms),
    r3(row.work_ms),
    r3(row.frame_interval_ms),
    row.face_detected ? 1 : 0,
    row.over_budget_work ? 1 : 0,
    row.over_budget_interval ? 1 : 0,
    row.visibility_state,
    row.perception_variant,
    row.blendshape_source,
    row.model_sha256 || "",
    row.mediapipe_blendshapes_enabled ? 1 : 0,
    row.avatar_backend || "vrm",
    row.gnm_state || "",
    row.gnm_fallback ? 1 : 0,
    r3(row.gnm_load_ms),
    r3(row.gnm_identity_fit_ms),
    r3(row.gnm_solve_ms),
    r3(row.gnm_forward_ms),
    r3(row.gnm_render_ms),
    r3(row.gnm_frame_ms),
  ].join(",");
}

function buildCollectCsv(rows) {
  return [COLLECT_HEADER, ...rows].join("\n");
}

function buildCollectMeta({
  deviceId, deviceLabel, coldConfirmed, seconds, analysisWindowMs, input, source,
  runSummaries, refreshHz, info, frontendVersion, variant, runtime, avatarBackend, gnm,
}) {
  const env = collectEnvironment({
    model: info?.model,
    avatar: info?.avatar,
    refreshHz,
  });
  const validRuns = runSummaries.filter((r) => r.valid);
  const averageFps = validRuns.length
    ? validRuns.reduce((sum, r) => sum + r.fps, 0) / validRuns.length
    : 0;
  return {
    schema: COLLECT_SCHEMA,
    collected_at: new Date().toISOString(),
    device_id: deviceId,
    device_label: deviceLabel || "",
    ua: env.userAgent,
    platform: env.platform,
    hardware_concurrency: env.hardwareConcurrency,
    device_memory_gb: navigator.deviceMemory ?? null,
    gpu_renderer: env.webglRenderer,
    wasm_simd: env.wasmSimd,
    screen: env.screen,
    viewport: env.viewport,
    dpr: env.devicePixelRatio,
    refresh_hz: env.refreshHz,
    input: {
      path: COLLECT_VIDEO_URL,
      sha256: input.sha256,
      duration_s: source.durationS,
      width: source.width,
      height: source.height,
      fps: 30,
    },
    avatar: {
      name: info?.avatar?.name || "vrm-girl",
      version: info?.avatar?.version || "1.0.0",
    },
    perception_model: info?.model
      ? `${info.model.name} ${info.model.version}`
      : "face_landmarker 1.0.0",
    perception_variant: variant?.key || "mp_full",
    variant_label: variant?.label || "MediaPipe Full",
    blendshape_source: variant?.blendshapeSource || "mediapipe",
    model_sha256: runtime?.sha256 || variant?.modelSha256 || "",
    mediapipe_blendshapes_enabled: variant?.mediapipeBlendshapes !== false,
    ort_provider: runtime?.provider || variant?.ortProvider || "",
    model_load_ms: runtime?.modelLoadMs ?? 0,
    avatar_backend: avatarBackend || "vrm",
    gnm_asset_version: gnm?.gnm_asset_version || "3.0.0",
    gnm_asset_sha256: gnm?.gnm_asset_sha256 || "",
    gnm_load_ms: gnm?.gnm_load_ms ?? 0,
    gnm_identity_fit_ms: gnm?.gnm_identity_fit_ms ?? 0,
    gnm_state: gnm?.gnm_state || "idle",
    gnm_fallback: !!gnm?.gnm_fallback,
    frontend_version: frontendVersion,
    run_seconds: seconds,
    analysis_window_ms: analysisWindowMs,
    cold_start_confirmed: !!coldConfirmed,
    unobserved: ["temperature", "power", "thermal_throttling", "background_apps"],
    runs: runSummaries,
    valid_runs: validRuns.length,
    invalid_runs: runSummaries.length - validRuns.length,
    average_fps: round(averageFps, 3) ?? 0,
  };
}

function collectOneRun({
  source, landmarker, detect, variant, runtime, avatar, avatarBackend, applyFrame,
  runId, deviceId, repeatIndex, cacheState, seconds, onTick, signal,
}) {
  return new Promise((resolve) => {
    const rows = [];
    const runStart = performance.now();
    let lastRaf = null;
    let lastTs = 0;
    let frameIndex = 0;
    let detected = 0;
    let hidden = false;
    let aborted = false;
    let lastTick = 0;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") hidden = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const finish = (error = null) => {
      document.removeEventListener("visibilitychange", onVisibility);
      resolve({ rows, detected, hidden, aborted, error });
    };

    const step = async (rafTime) => {
      try {
        if (signal?.aborted) {
          aborted = true;
          return finish();
        }
        if (hidden || document.visibilityState === "hidden") {
          hidden = true;
          return finish();
        }
        const now = performance.now();
        if (now - runStart >= seconds * 1000) return finish();

        const canvas = source.draw(now);
        let ts = Math.round(now);
        if (ts <= lastTs) ts = lastTs + 1;
        lastTs = ts;

        const got = await detect(canvas, "video", ts);
        if (signal?.aborted) {
          aborted = true;
          return finish();
        }
        const frame = got.frame;
        const perceptionMs = got.perceptionMs || 0;
        const onnxMs = got.onnxMs || 0;
        let mappingMs = 0;
        if (frame) {
          try {
            applyFrame(frame);
            mappingMs = avatar?.lastMappingMs || 0;
          } catch {}
        }
        const timing = avatar?.lastTiming || { rigMs: 0, renderMs: 0 };
        const interval = lastRaf == null ? 0 : Math.max(0, rafTime - lastRaf);
        lastRaf = rafTime;
        const rigMs = timing.rigMs || 0;
        const renderMs = timing.renderMs || 0;
        const workMs = perceptionMs + onnxMs + mappingMs + rigMs + renderMs;
        const gnm = avatar?.lastGnm || null;
        if (frame) detected++;

        rows.push({
          run_id: runId,
          device_id: deviceId,
          repeat_index: repeatIndex,
          cache_state: cacheState,
          timestamp_ms: Math.round(now - runStart),
          video_time_ms: Math.round(source.videoTimeMs?.() ?? 0),
          frame_index: frameIndex,
          perception_ms: perceptionMs,
          onnx_ms: onnxMs,
          mapping_ms: mappingMs,
          rig_ms: rigMs,
          render_ms: renderMs,
          work_ms: workMs,
          frame_interval_ms: interval,
          face_detected: frame ? 1 : 0,
          over_budget_work: workMs > FRAME_BUDGET_MS ? 1 : 0,
          over_budget_interval: interval > FRAME_BUDGET_MS ? 1 : 0,
          visibility_state: 1,
          perception_variant: variant?.key || "mp_full",
          blendshape_source: variant?.blendshapeSource || "mediapipe",
          model_sha256: runtime?.sha256 || variant?.modelSha256 || "",
          mediapipe_blendshapes_enabled: variant?.mediapipeBlendshapes !== false,
          avatar_backend: avatarBackend || "vrm",
          gnm_state: gnm?.gnm_state || "",
          gnm_fallback: gnm?.gnm_fallback ? 1 : 0,
          gnm_load_ms: gnm?.gnm_load_ms || 0,
          gnm_identity_fit_ms: gnm?.gnm_identity_fit_ms || 0,
          gnm_solve_ms: gnm?.gnm_solve_ms || 0,
          gnm_forward_ms: gnm?.gnm_forward_ms || 0,
          gnm_render_ms: gnm?.gnm_render_ms || 0,
          gnm_frame_ms: gnm?.gnm_frame_ms || 0,
        });
        frameIndex++;

        if (now - lastTick > 200) {
          lastTick = now;
          onTick?.({
            repeatIndex,
            cacheState,
            elapsedMs: now - runStart,
            seconds,
          });
        }
        requestAnimationFrame(step);
      } catch (e) {
        finish(e);
      }
    };
    requestAnimationFrame(step);
  });
}

function collectAbortError() {
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
  }
}

async function collectAll({
  getLandmarker, getAvatar, getAvatarBackend, applyFrame, getInfo, detectFrame, variant, getRuntime,
  seconds, label, frontendVersion, ui, signal,
}) {
  const landmarker = getLandmarker();
  const avatar = getAvatar();
  if (!landmarker) throw new Error("推理引擎未就绪");
  if (!avatar?.ready) throw new Error("数字虚拟人未就绪");

  const runtime = getRuntime?.() || null;
  const avatarBackend = getAvatarBackend?.() || "vrm";
  const deviceId = getCollectDeviceId();
  const deviceLabel = (ui.labelInput.value || label || "").trim();
  const batchStamp = collectStamp();
  const analysisWindowMs = seconds <= 3 ? 0 : 1000;

  ui.status.textContent = "准备 Benchmark…";
  if (signal?.aborted) throw collectAbortError();
  const resp = await fetch(COLLECT_VIDEO_URL, { cache: "no-cache", signal });
  if (!resp.ok) throw new Error(`固定视频加载失败：HTTP ${resp.status}`);
  if (signal?.aborted) throw collectAbortError();
  const blob = await resp.blob();
  const sha256 = await sha256Hex(await blob.arrayBuffer());
  if (signal?.aborted) throw collectAbortError();
  const file = new File([blob], "single-face-30fps.mp4", { type: "video/mp4" });
  const preview = document.getElementById("collect-preview");
  const source = await createSource("local-video", file, {
    srcUrl: COLLECT_VIDEO_URL,
    videoEl: preview,
    onStatus: () => { ui.status.textContent = "准备 Benchmark…"; },
    signal,
  });
  if (signal?.aborted) {
    source.cleanup();
    throw collectAbortError();
  }
  if (!source.width || !source.height) {
    source.cleanup();
    throw new Error("固定视频尺寸未就绪，请刷新重试");
  }

  ui.status.textContent = "Benchmark 进行中…";
  const refreshHz = await measureRefreshHz();
  const info = getInfo?.() || {};
  const rows = [];
  const runSummaries = [];
  let aborted = false;

  try {
    for (let repeatIndex = 1; repeatIndex <= COLLECT_REPEATS; repeatIndex++) {
      if (aborted || signal?.aborted) {
        aborted = true;
        break;
      }
      const cacheState = repeatIndex === 1 ? "cold" : "warm";
      const runId = `${deviceId}-${batchStamp}-${avatarBackend}-r${String(repeatIndex).padStart(2, "0")}`;
      ui.status.textContent = "Benchmark 进行中…";
      ui.bar.style.transform = `scaleX(${Math.min(1, (repeatIndex - 1) / COLLECT_REPEATS)})`;

      try {
        await source.reset();
      } catch (e) {
        runSummaries.push({
          repeat_index: repeatIndex,
          run_id: runId,
          cache_state: cacheState,
          load_ms: null,
          startup_ms: null,
          valid: false,
          invalid_reason: "video_error",
          face_detection_ratio: 0,
          fps: 0,
          frame_count: 0,
        });
        aborted = true;
        break;
      }

      const result = await collectOneRun({
        source,
        landmarker,
        detect: detectFrame,
        variant,
        runtime,
        avatar,
        avatarBackend,
        applyFrame,
        runId,
        deviceId,
        repeatIndex,
        cacheState,
        seconds,
        signal,
        onTick: (tick) => {
          const remaining = (COLLECT_REPEATS - tick.repeatIndex) * tick.seconds +
            (tick.seconds - tick.elapsedMs / 1000);
          const fraction = (tick.repeatIndex - 1) + Math.min(1, tick.elapsedMs / (tick.seconds * 1000));
          ui.status.textContent = `Benchmark 进行中 · ${approxRemainingLabel(remaining)}`;
          ui.bar.style.transform = `scaleX(${Math.min(1, fraction / COLLECT_REPEATS)})`;
        },
      });

      if (result.error) throw result.error;
      rows.push(...result.rows);
      const windowRows = result.rows.filter((r) => r.timestamp_ms >= analysisWindowMs);
      const ratio = result.rows.length ? result.detected / result.rows.length : 0;
      const wasAborted = !!result.aborted || !!signal?.aborted;
      const valid = !wasAborted && !result.hidden && ratio >= 0.5 && windowRows.length >= 2;
      const invalidReason = wasAborted
        ? "aborted"
        : result.hidden
          ? "hidden"
          : ratio < 0.5
            ? "low_face_detection"
            : windowRows.length < 2
              ? "too_few_frames"
              : null;
      const elapsed = windowRows.length >= 2
        ? windowRows[windowRows.length - 1].timestamp_ms - windowRows[0].timestamp_ms
        : 0;
      const fps = valid && elapsed > 0 ? (windowRows.length / elapsed) * 1000 : 0;
      const onnxValues = result.rows.map((r) => r.onnx_ms).filter((v) => Number.isFinite(v));
      const mappingValues = result.rows.map((r) => r.mapping_ms).filter((v) => Number.isFinite(v));
      const workValues = result.rows.map((r) => r.work_ms).filter((v) => Number.isFinite(v));
      const onnxStats = summarize(onnxValues);
      const mappingStats = summarize(mappingValues);
      const workStats = summarize(workValues);
      const summary = {
        repeat_index: repeatIndex,
        run_id: runId,
        cache_state: cacheState,
        load_ms: null,
        startup_ms: null,
        valid,
        invalid_reason: invalidReason,
        face_detection_ratio: round(ratio, 3) ?? 0,
        fps: round(fps, 3) ?? 0,
        frame_count: windowRows.length,
        onnx_p50_ms: round(onnxStats.p50, 3),
        onnx_p95_ms: round(onnxStats.p95, 3),
        mapping_p50_ms: round(mappingStats.p50, 3),
        mapping_p95_ms: round(mappingStats.p95, 3),
        work_p50_ms: round(workStats.p50, 3),
        work_p95_ms: round(workStats.p95, 3),
      };
      runSummaries.push(summary);
      ui.addRun(summary);
      if (wasAborted) {
        aborted = true;
        ui.status.textContent = "Benchmark 已终止；已完成数据可下载。";
      } else if (result.hidden) {
        aborted = true;
        ui.status.textContent = "页面切到后台，Benchmark 已中止。";
      }
    }
  } finally {
    source.cleanup();
    try {
      preview?.pause();
    } catch {}
  }

  const meta = buildCollectMeta({
    deviceId,
    deviceLabel,
    coldConfirmed: false,
    seconds,
    analysisWindowMs,
    input: { sha256 },
    source,
    runSummaries,
    refreshHz,
    info,
    frontendVersion,
    variant,
    runtime,
    avatarBackend,
    gnm: avatar?.lastGnm || null,
  });
  const csv = buildCollectCsv(rows.map((r) => collectRow(
    r.run_id, r.device_id, r.repeat_index, r.cache_state, r
  )));
  ui.finish({ rows, meta, csv, deviceId, batchStamp, runSummaries, aborted });
}

export function startCollectMode({
  getLandmarker,
  getAvatar,
  applyFrame,
  getInfo,
  detectFrame,
  variant,
  getRuntime,
  getAvatarBackend,
  seconds = 30,
  label = "",
  frontendVersion = "v26",
}) {
  const $ = (id) => document.getElementById(id);
  const card = $("collect-card");
  if (!card) return null;

  const secs = Math.max(1, Math.min(300, Number(seconds) || 30));
  const ui = {
    card,
    status: $("collect-status"),
    bar: $("collect-bar"),
    runs: $("collect-runs"),
    summary: $("collect-summary"),
    zip: $("collect-zip"),
    abort: $("collect-abort"),
    labelInput: $("collect-label"),
    start: $("collect-start"),
    note: $("collect-note"),
    addRun(summary) {
      const li = document.createElement("li");
      li.textContent = `第 ${summary.repeat_index} 轮 · ${summary.cache_state} · ${
        summary.valid ? `${summary.fps} FPS` : `无效（${summary.invalid_reason}）`
      }`;
      this.runs.appendChild(li);
    },
    finish({ rows, meta, csv, deviceId, batchStamp, runSummaries, aborted }) {
      if (!aborted) this.bar.style.transform = "scaleX(1)";
      const valid = runSummaries.filter((r) => r.valid);
      const avg = valid.length
        ? valid.reduce((sum, r) => sum + r.fps, 0) / valid.length
        : 0;
      if (aborted) {
        this.summary.textContent = "Benchmark 已中止";
      } else if (valid.length === runSummaries.length) {
        this.summary.textContent = `Benchmark 完成 · 平均 ${(round(avg, 3) ?? 0)} FPS`;
      } else {
        this.summary.textContent = "Benchmark 完成 · 部分数据无效";
      }
      this.status.textContent = aborted
        ? "Benchmark 已中止；已完成数据可下载。"
        : "Benchmark 完成；可下载数据。";
      if (rows.length > 0) {
        const base = `dash-collect-${meta.avatar_backend || "vrm"}-${variant?.key || "mp_full"}-${String(deviceId).slice(0, 8)}-${batchStamp}`;
        const zip = makeCollectZip([
          { name: `${base}.csv`, data: `\uFEFF${csv}` },
          { name: `${base}-meta.json`, data: JSON.stringify(meta, null, 2) },
        ]);
        this.zip.onclick = () => download(`${base}.zip`, zip, "application/zip");
      }
      this.zip.hidden = !this.zip.onclick;
      this.zip.disabled = !this.zip.onclick;
    },
  };

  ui.runs.hidden = true;
  const timeEl = $("collect-time");
  if (timeEl) {
    const suffix = variant && variant.key !== "mp_full" ? ` · ${variant.label}` : "";
    timeEl.textContent = `标准测试${suffix}：${approxCollectLabel(secs)}；固定测试视频，不显示画面，请保持前台。`;
  }
  const intro = $("collect-intro");
  if (intro) {
    intro.textContent = `本地测试，不调用摄像头、不上传；全程${approxCollectLabel(secs)}，请保持页面在前台。`;
  }
  ui.start.textContent = `开始 Benchmark（${approxCollectLabel(secs)}）`;
  ui.labelInput.value = label || "";
  if (ui.note) {
    ui.note.textContent = "测试视频，非摄像头画面；本地处理，不上传；请保持页面在前台。";
  }

  let running = false;
  let ready = false;
  let collectAbort = null;
  const sync = () => {
    ui.start.disabled = running || !ready;
    if (ui.abort) ui.abort.hidden = !running;
  };
  ui.abort?.addEventListener("click", () => {
    if (!running) return;
    ui.abort.disabled = true;
    ui.status.textContent = "正在终止 Benchmark…";
    collectAbort?.abort();
  });
  ui.start.addEventListener("click", async () => {
    if (running || !ready) return;
    running = true;
    sync();
    ui.labelInput.disabled = true;
    ui.start.textContent = "Benchmark 进行中…";
    ui.abort.disabled = false;
    ui.runs.innerHTML = "";
    ui.summary.textContent = "";
    ui.bar.style.transform = "scaleX(0)";
    ui.zip.hidden = true;
    ui.zip.disabled = true;
    collectAbort = new AbortController();
    try {
      await collectAll({
        getLandmarker,
        getAvatar,
        applyFrame,
        getInfo,
        detectFrame,
        variant,
        getRuntime,
        getAvatarBackend,
        seconds: secs,
        label,
        frontendVersion,
        ui,
        signal: collectAbort.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        ui.status.textContent = "Benchmark 已终止。";
        if (ui.zip.onclick) {
          ui.summary.textContent = "Benchmark 已终止；上一组数据仍可下载。";
        }
      } else {
        ui.status.textContent = `Benchmark 失败：${e.message || e}`;
      }
    } finally {
      running = false;
      ui.labelInput.disabled = false;
      ui.start.textContent = `开始 Benchmark（${approxCollectLabel(secs)}）`;
      if (ui.abort) {
        ui.abort.hidden = true;
        ui.abort.disabled = false;
      }
      if (ui.zip.onclick) {
        ui.zip.hidden = false;
        ui.zip.disabled = false;
      } else {
        ui.zip.hidden = true;
        ui.zip.disabled = true;
      }
      sync();
    }
  });

  ui.status.textContent = "等待模型就绪…";
  sync();
  return {
    setReady(on) {
      ready = !!on;
      sync();
      if (ready && !running) ui.status.textContent = "已就绪；可开始 Benchmark。";
    },
    abort() {
      if (!running) return;
      ui.status.textContent = "正在终止 Benchmark…";
      collectAbort?.abort();
    },
    seconds: secs,
  };
}
