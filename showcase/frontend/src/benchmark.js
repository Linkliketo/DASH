// 性能测试：端到端 FPS / 感知推理 / rig+渲染 / 工作量长尾。
// 数据源只允许真实媒体（内置隐藏头像 / 本地图片 / 本地视频 / 摄像头），不做合成信号。
// 判定规则见 benchmark-rules.js：帧间隔受刷新率量化，只作诊断；判定以工作量与吞吐为准。
import { toFrame } from "./perception.js?v=9";
import {
  TARGET_FPS,
  FRAME_BUDGET_MS,
  LONG_TAIL_BUDGET_MS,
  WORK_OVER_BUDGET_WARN_RATIO,
  evaluateVerdict,
  verdictLabel,
} from "./benchmark-rules.js?v=9";

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

function waitEvent(target, event, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const on = (e) => {
      cleanup();
      resolve(e);
    };
    const cleanup = () => {
      target.removeEventListener(event, on);
      if (timer) clearTimeout(timer);
    };
    target.addEventListener(event, on, { once: true });
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

async function createSource(kind, file, { getActiveCamera, onStatus }) {
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
    draw: null,
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
      video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = revoke;
      await waitEvent(video, "loadedmetadata");
      await video.play();
      await waitFirstVideoFrame(video);
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
      faceExpected: true,
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
  constructor({ getLandmarker, applyFrame, ensureAvatar, getAvatar }) {
    this.getLandmarker = getLandmarker;
    this.applyFrame = applyFrame;
    this.ensureAvatar = ensureAvatar;
    this.getAvatar = getAvatar;
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
      const avatar = this.getAvatar();
      if (!avatar) throw new Error("皮套人渲染器未就绪");

      onStatus?.("加载皮套人…");
      const avatarOk = await this.ensureAvatar();
      if (!avatarOk) throw new Error("皮套人加载失败，无法开始测试");
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
        landmarker, avatar, source, durationMode, targetMs, targetFrames,
        warmupMs, getInfo, avatarLoadMs, onLive,
      });

      return result;
    } finally {
      this._running = false;
      this._abortReason = null;
      document.removeEventListener("visibilitychange", this._onVisibility);
      source?.cleanup?.();
    }
  }

  _loop({ landmarker, avatar, source, durationMode, targetMs, targetFrames, warmupMs, getInfo, avatarLoadMs, onLive }) {
    return new Promise((resolve, reject) => {
      const refreshPromise = measureRefreshHz();
      const intervals = [];
      const perception = [];
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

      const step = (now) => {
        if (this._abortReason) return reject(new BenchmarkAbort(this._abortReason));
        if (!loopStart) loopStart = now;
        if (lastTick && now - lastTick > 5000) {
          return reject(new BenchmarkAbort("检测到 rAF 冻结（标签页后台或主线程阻塞）"));
        }

        try {
          const frameSource = source.draw(now);
          const t0 = performance.now();
          let ts = Math.round(now);
          if (ts <= lastTs) ts = lastTs + 1;
          lastTs = ts;
          const frame = landmarker.inferVideo
            ? landmarker.inferVideo(frameSource, ts)
            : toFrame(landmarker.detectForVideo(frameSource, ts));
          const t1 = performance.now();
          if (frame) this.applyFrame?.(frame, { mirror: !!source.cameraUsed });
          const t2 = performance.now();
          const timing = avatar.lastTiming || { rigMs: 0, renderMs: 0 };
          const workMs = t1 - t0 + (t2 - t1) + timing.rigMs + timing.renderMs;

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
            perception.push(t1 - t0);
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
    ["感知推理 均值 / P95", `${fmt(r.metrics.perceptionMs.mean, "ms")} / ${fmt(r.metrics.perceptionMs.p95, "ms")}`, "—", "—"],
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
    ["皮套人", `${env.avatar?.name || "—"} ${env.avatar?.version || ""}`.trim()],
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
    `> 口径：判定以「平均帧率 + 平均/P95 工作量」为准；帧间隔受显示刷新率量化，仅作调度诊断。感知耗时只统计 detectForVideo；rig+渲染来自渲染循环埋点；工作量 = 感知 + 表情映射 + rig + 渲染，不含测试页的 canvas 重采样。`,
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
    ["metrics", "rigMean", m.rigRenderMs.rig.mean, "ms", "", ""],
    ["metrics", "renderMean", m.rigRenderMs.render.mean, "ms", "", ""],
    ["metrics", "rigRenderP95", m.rigRenderMs.total.p95, "ms", "", ""],
  ];
  rows.push(...metricRows);
  const s = r.source;
  rows.push(
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
  return `dash-benchmark-${fileStamp()}.${ext}`;
}

/* ---------------- 面板（DOM 绑定 + 导出） ---------------- */

function download(name, text, type) {
  const blob = new Blob([text], { type });
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
  onStart, onEnd,
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
  const runner = new BenchmarkRunner({ getLandmarker, applyFrame, ensureAvatar, getAvatar });

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

  function syncModeUi() {
    const duration = els.mode.value === "duration";
    els.unit.textContent = duration ? "s" : "帧";
    els.value.min = duration ? "5" : "30";
    els.value.max = duration ? "600" : "3000";
    els.value.value = duration ? "30" : "300";
    els.start.disabled = busy || !ready;
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
      ["感知推理 均值 / P95 / 最大", `${fmt(r.metrics.perceptionMs.mean)} / ${fmt(r.metrics.perceptionMs.p95)} / ${fmt(r.metrics.perceptionMs.max)} ms`],
      ["rig 均值 / 渲染均值", `${fmt(r.metrics.rigRenderMs.rig.mean)} / ${fmt(r.metrics.rigRenderMs.render.mean)} ms`],
      ["统计帧数 / 时长", `${r.metrics.frames} / ${(r.metrics.elapsedMs / 1000).toFixed(1)} s`],
      ["摄像头 / 图像上传", `${r.source.cameraUsed ? "已调用" : "未调用"} / 否`],
      ["皮套人加载", `${fmt(r.setup.avatarLoadMs, "ms")}`],
      ["UA", r.environment.userAgent],
      ["CPU 核数 / DPR", `${r.environment.hardwareConcurrency ?? "—"} / ${r.environment.devicePixelRatio ?? "—"}`],
      ["屏幕 / 视口", `${r.environment.screen} / ${r.environment.viewport}`],
      ["WebGL renderer", r.environment.webglRenderer || "—"],
      ["WASM SIMD", r.environment.wasmSimd ? "支持" : "不支持"],
      ["显示刷新率（估计）", r.environment.refreshHz ? `${r.environment.refreshHz} Hz` : "—"],
      ["感知模型 / 皮套人", `${r.environment.model?.name || "—"} ${r.environment.model?.version || ""} / ${r.environment.avatar?.name || "—"} ${r.environment.avatar?.version || ""}`],
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
