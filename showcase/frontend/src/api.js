// 后端 API 客户端（showcase.backend service，同源部署）
const BASE = location.origin;

async function check(resp, what) {
  if (!resp.ok) {
    let detail = `${what} failed: HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body && body.error) detail = body.error;
    } catch {}
    throw new Error(detail);
  }
  return resp;
}

export async function health() {
  const resp = await fetch(`${BASE}/api/health`);
  return check(resp, "health").then((r) => r.json());
}

export async function listBackends() {
  const resp = await fetch(`${BASE}/api/backends`);
  return check(resp, "backends").then((r) => r.json());
}

export async function switchBackend(name) {
  const resp = await fetch(`${BASE}/api/backend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return check(resp, "switch backend").then((r) => r.json());
}

export async function analyzePhoto(blob) {
  const resp = await fetch(`${BASE}/api/photo`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  return check(resp, "photo").then((r) => r.json());
}

// 视频处理：NDJSON 流式读取，每行回调一次
export async function streamVideo(file, onFrame, onError) {
  const form = new FormData();
  form.append("file", file, file.name || "video.mp4");
  let resp;
  try {
    resp = await fetch(`${BASE}/api/video`, { method: "POST", body: form });
  } catch (e) {
    onError && onError(e);
    return;
  }
  if (!resp.ok) {
    onError && onError(new Error(`video upload failed: HTTP ${resp.status}`));
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        onFrame(JSON.parse(line));
      } catch {}
    }
  }
}

// 实时表情流（摄像头模式）
export function connectFaceWS(onFrame, onOpen, onClose) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/face`);
  ws.onopen = () => onOpen && onOpen();
  ws.onmessage = (e) => {
    try {
      onFrame(JSON.parse(e.data));
    } catch {}
  };
  ws.onclose = () => onClose && onClose();
  return ws;
}

export function cameraStreamUrl() {
  return `${BASE}/api/camera/stream`;
}
