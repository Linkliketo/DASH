function abortError() {
  return new DOMException("Aborted", "AbortError");
}

export async function processVideo(video, adapter, options = {}) {
  const {
    strideMs = 66,
    signal,
    onProgress,
    seekTimeoutMs = 1000,
  } = options;

  if (!Number.isFinite(strideMs) || strideMs <= 0) {
    throw new Error("strideMs must be greater than 0");
  }
  if (!Number.isFinite(seekTimeoutMs) || seekTimeoutMs < 0) {
    throw new Error("seekTimeoutMs must be zero or greater");
  }
  if (adapter.capabilities?.temporal && typeof adapter.reset !== "function") {
    throw new Error("temporal adapter requires reset()");
  }

  if (adapter.reset) await adapter.reset();

  const frames = [];
  const durationMs = video.duration * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return frames;
  const total = Math.ceil(durationMs / strideMs);
  video.pause();

  const waitForSeek = () =>
    new Promise((resolve, reject) => {
      let timer = null;

      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        signal?.removeEventListener("abort", onAbort);
        if (timer) clearTimeout(timer);
      };

      const onSeeked = () => {
        cleanup();
        resolve();
      };

      const onAbort = () => {
        cleanup();
        reject(abortError());
      };

      video.addEventListener("seeked", onSeeked, { once: true });

      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(abortError());
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      if (seekTimeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error("video seek timed out"));
        }, seekTimeoutMs);
      }
    });

  for (let t = 0, i = 0; t < durationMs; t += strideMs, i++) {
    if (signal?.aborted) throw abortError();

    const target = t / 1000;
    if (Math.abs(video.currentTime - target) > 1e-3) {
      video.currentTime = target;
      await waitForSeek();
    }

    const frame = await adapter.infer(video, Math.round(t));
    if (signal?.aborted) throw abortError();

    const timestampMs = Number.isFinite(frame?.timestampMs) ? frame.timestampMs : Math.round(t);
    const item = { frame: i, timestampMs, ok: !!frame };

    if (frame) {
      item.blendshapes = frame.blendshapes;
      item.landmarks = frame.landmarks;
      item.headEuler = frame.headEuler;
    }

    frames.push(item);
    if (onProgress) onProgress(frames.length, total);
  }

  return frames;
}
