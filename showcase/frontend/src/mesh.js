// 478 点人脸网格叠加层（2D canvas，覆盖在源画面上）
export class MeshOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.enabled = true;
  }

  // 让 canvas 精确覆盖 media 元素的实际内容区（object-fit: contain 的信箱计算）
  fitTo(mediaEl) {
    if (!mediaEl) return;
    const box = mediaEl.parentElement.getBoundingClientRect();
    const mw = mediaEl.naturalWidth || mediaEl.videoWidth || box.width;
    const mh = mediaEl.naturalHeight || mediaEl.videoHeight || box.height;
    if (!mw || !mh || !box.width || !box.height) return;
    const scale = Math.min(box.width / mw, box.height / mh);
    const w = mw * scale;
    const h = mh * scale;
    const left = (box.width - w) / 2;
    const top = (box.height - h) / 2;
    const dpr = Math.min(window.devicePixelRatio, 2);
    Object.assign(this.canvas.style, {
      width: `${w}px`,
      height: `${h}px`,
      left: `${left}px`,
      top: `${top}px`,
    });
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
  }

  // landmarks: 1434 个归一化浮点（x,y,z 交错，契约里的 flat 列表）
  draw(landmarks) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.enabled || !landmarks || landmarks.length !== 1434) return;
    const w = canvas.width;
    const h = canvas.height;
    const r = Math.max(1, w / 480);
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--marker")
      .trim() || "#0EA5E9";
    ctx.beginPath();
    for (let i = 0; i < 478; i++) {
      const x = landmarks[i * 3] * w;
      const y = landmarks[i * 3 + 1] * h;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
