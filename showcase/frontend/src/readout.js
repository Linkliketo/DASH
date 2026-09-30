// 签名元素：实时表情读数（时间轴样式，分组版）
// 固定轨道、固定顺序：每条轨道 x 轴 = 最近 10 秒（右缘 = 现在），y 轴 = 数值 [0,1]。
// 没有返回值时轨道照常推进、值为 0 —— 行不增删、不重排，减少无序变动。
// 分组：A 版本只有「面部」组；B 版本加「骨骼框架」「手部骨骼」组。
const WINDOW_MS = 10_000;

// 面部组：覆盖皮套人实际驱动的 VRM expression 来源
export const FACE_TRACKS = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "browInnerUp",
  "browDownLeft",
  "browDownRight",
  "jawOpen",
  "mouthSmileLeft",
  "mouthSmileRight",
];

export const GROUPS_A = [{ title: "面部 FACE", tracks: FACE_TRACKS }];

export const GROUPS_B = [
  { title: "面部 FACE", tracks: FACE_TRACKS },
  {
    title: "骨骼框架 SKELETON",
    tracks: ["shoulderLiftL", "shoulderLiftR", "elbowCurlL", "elbowCurlR", "spineLean"],
  },
  {
    title: "手部骨骼 HANDS",
    tracks: ["indexCurlL", "indexCurlR", "fistL", "fistR"],
  },
];

export class Readout {
  constructor(container, groups = GROUPS_A) {
    this.container = container;
    this.windowMs = WINDOW_MS;
    this.rows = [];
    this.rebuild(groups);
  }

  // 按版本重建分组（A/B 切换时调用）
  rebuild(groups) {
    this.container.innerHTML = "";
    this.rows = [];
    for (const group of groups) {
      const box = document.createElement("div");
      box.className = "readout-group";
      const title = document.createElement("div");
      title.className = "readout-group-title mono";
      title.textContent = group.title;
      box.appendChild(title);
      this.container.appendChild(box);
      for (const name of group.tracks) this.rows.push(this._row(box, name));
    }
  }

  _row(parent, name) {
    const el = document.createElement("div");
    el.className = "readout-row";
    el.innerHTML = `
      <span class="readout-name">${name}</span>
      <canvas class="readout-track"></canvas>
      <span class="readout-value mono">0.00</span>`;
    parent.appendChild(el);
    return {
      name,
      canvas: el.querySelector(".readout-track"),
      ctx: el.querySelector(".readout-track").getContext("2d"),
      valueEl: el.querySelector(".readout-value"),
      samples: [],
    };
  }

  _draw(row, now) {
    const { canvas, ctx, samples } = row;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 30;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(30,41,59,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    if (samples.length < 2) return;
    const t0 = now - this.windowMs;
    ctx.beginPath();
    let started = false;
    for (const [t, v] of samples) {
      const x = ((t - t0) / this.windowMs) * w;
      const y = h - Math.min(1, v) * (h - 2) - 1;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "#2563EB";
    ctx.lineWidth = Math.max(1.5, dpr);
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(((samples[0][0] - t0) / this.windowMs) * w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,0.14)";
    ctx.fill();
  }

  // cats: [{categoryName, score}]（面部）；extras: {name: value}（骨骼/手部派生指标）。
  // 两者都可空 —— 空即按 0 推进。
  update(cats, extras) {
    const now = performance.now();
    const cutoff = now - this.windowMs;
    const scores = new Map();
    if (cats) for (const c of cats) scores.set(c.categoryName, c.score);
    if (extras) for (const [k, v] of Object.entries(extras)) scores.set(k, v);
    for (const row of this.rows) {
      const v = scores.get(row.name) ?? 0;
      row.samples.push([now, v]);
      while (row.samples.length && row.samples[0][0] < cutoff) row.samples.shift();
      row.valueEl.textContent = v.toFixed(2);
      this._draw(row, now);
    }
  }

  reset() {
    for (const row of this.rows) {
      row.samples = [];
      row.valueEl.textContent = "0.00";
      row.ctx.clearRect(0, 0, row.canvas.width, row.canvas.height);
    }
  }

  /* ---------------- 视频回放模式：时间轴跟随视频进度而非墙钟 ---------------- */

  // frames: 已处理帧 [{timestampMs, scores:{name:v}}]，tMs: 当前视频时间。
  // 窗口 [t-10s, t]：往回拖进度条，时间轴跟着往回走。
  renderPlayback(frames, tMs) {
    const t0 = tMs - this.windowMs;
    for (const row of this.rows) {
      const series = [];
      let current = 0;
      for (const f of frames) {
        if (f.timestampMs > tMs) break;
        const v = f.scores?.[row.name] ?? 0;
        current = v;
        if (f.timestampMs >= t0) series.push([f.timestampMs, v]);
      }
      row.valueEl.textContent = current.toFixed(2);
      this._drawSeries(row, series, t0);
    }
  }

  _drawSeries(row, series, t0) {
    const { canvas, ctx } = row;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 30;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(30,41,59,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();
    if (series.length < 2) return;
    ctx.beginPath();
    let started = false;
    for (const [t, v] of series) {
      const x = ((t - t0) / this.windowMs) * w;
      const y = h - Math.min(1, v) * (h - 2) - 1;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "#2563EB";
    ctx.lineWidth = Math.max(1.5, dpr);
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(((series[0][0] - t0) / this.windowMs) * w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,0.14)";
    ctx.fill();
  }
}
