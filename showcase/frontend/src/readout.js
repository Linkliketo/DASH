// 签名元素：实时表情读数（时间轴样式）
// 固定轨道、固定顺序：每条轨道 x 轴 = 最近 10 秒（右缘 = 现在），y 轴 = 分数。
// 没有返回值时轨道照常推进、值为 0 —— 行不增删、不重排，减少无序变动。
const WINDOW_MS = 10_000;

// 固定轨道（顺序 = 显示顺序）：覆盖皮套人实际驱动的 VRM expression 来源
const TRACKS = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "browInnerUp",
  "browDownLeft",
  "browDownRight",
  "jawOpen",
  "mouthSmileLeft",
  "mouthSmileRight",
];

export class Readout {
  constructor(container, tracks = TRACKS) {
    this.container = container;
    this.windowMs = WINDOW_MS;
    this.rows = [];
    for (const name of tracks) this.rows.push(this._row(name));
  }

  _row(name) {
    const el = document.createElement("div");
    el.className = "readout-row";
    el.innerHTML = `
      <span class="readout-name">${name}</span>
      <canvas class="readout-track"></canvas>
      <span class="readout-value mono">0.00</span>`;
    this.container.appendChild(el);
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

    // 中线参考
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
    // 线下半透明填充
    ctx.lineTo(w, h);
    ctx.lineTo(((samples[0][0] - t0) / this.windowMs) * w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(37,99,235,0.14)";
    ctx.fill();
  }

  // cats: [{categoryName, score}]，每帧调用；传 [] 或空 = 全部按 0 推进
  update(cats) {
    const now = performance.now();
    const cutoff = now - this.windowMs;
    const scores = new Map();
    if (cats) for (const c of cats) scores.set(c.categoryName, c.score);
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
}
