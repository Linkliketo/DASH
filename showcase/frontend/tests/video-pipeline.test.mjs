import test from "node:test";
import assert from "node:assert/strict";
import { processVideo } from "../src/video/pipeline.js";

class FakeVideo {
  constructor({ duration = 0.2, emitSeek = true } = {}) {
    this.duration = duration;
    this._currentTime = 0;
    this._emitSeek = emitSeek;
    this._listeners = new Map();
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    this._currentTime = value;
    if (this._emitSeek) {
      queueMicrotask(() => this._emit("seeked"));
    }
  }

  pause() {}

  addEventListener(type, listener) {
    this._listeners.set(type, listener);
  }

  removeEventListener(type) {
    this._listeners.delete(type);
  }

  _emit(type) {
    const listener = this._listeners.get(type);
    if (listener) listener();
  }
}

const adapter = {
  async infer(video, timestampMs) {
    return {
      timestampMs,
      blendshapes: [{ categoryName: "jawOpen", score: 0.5 }],
    };
  },
};

test("processVideo samples timestamps and reports progress", async () => {
  const video = new FakeVideo();
  const progress = [];
  const frames = await processVideo(video, adapter, {
    strideMs: 66,
    onProgress: (done, total) => progress.push([done, total]),
  });

  assert.equal(frames.length, 4);
  assert.deepEqual(
    frames.map((frame) => frame.timestampMs),
    [0, 66, 132, 198],
  );
  assert.equal(frames[0].ok, true);
  assert.equal(frames[0].blendshapes[0].categoryName, "jawOpen");
  assert.deepEqual(progress, [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ]);
});

test("processVideo stops when aborted", async () => {
  const video = new FakeVideo();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => processVideo(video, adapter, { signal: controller.signal }),
    (error) => error.name === "AbortError",
  );
});

test("processVideo rejects when seeking times out", async () => {
  const video = new FakeVideo({ emitSeek: false });

  await assert.rejects(
    () => processVideo(video, adapter, { strideMs: 66, seekTimeoutMs: 10 }),
    /seek timed out/,
  );
});

test("processVideo prefers adapter timestamps", async () => {
  const video = new FakeVideo();
  const timedAdapter = {
    async infer(video, timestampMs) {
      return { timestampMs: timestampMs + 1000, blendshapes: { jawOpen: 0.4 } };
    },
  };

  const frames = await processVideo(video, timedAdapter, { strideMs: 66 });
  assert.deepEqual(
    frames.map((frame) => frame.timestampMs),
    [1000, 1066, 1132, 1198],
  );
});

test("processVideo stops when aborted mid-run", async () => {
  const video = new FakeVideo();
  const controller = new AbortController();
  let calls = 0;
  const abortingAdapter = {
    async infer() {
      calls++;
      return { blendshapes: { jawOpen: 0.4 } };
    },
  };

  await assert.rejects(
    () =>
      processVideo(video, abortingAdapter, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    (error) => error.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("processVideo aborts a pending seek immediately", async () => {
  const video = new FakeVideo({ emitSeek: false });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);

  await assert.rejects(
    () =>
      processVideo(video, adapter, {
        signal: controller.signal,
        seekTimeoutMs: 1000,
      }),
    (error) => error.name === "AbortError",
  );
});

test("processVideo validates stride", async () => {
  await assert.rejects(
    () => processVideo(new FakeVideo(), adapter, { strideMs: 0 }),
    /strideMs must be greater than 0/,
  );
});

test("processVideo resets adapters and rejects temporal adapters without reset", async () => {
  const resetCalls = [];
  const resettable = {
    async reset() {
      resetCalls.push("reset");
    },
    async infer() {
      return { blendshapes: { jawOpen: 0.4 } };
    },
  };
  await processVideo(new FakeVideo(), resettable, { strideMs: 66 });
  assert.deepEqual(resetCalls, ["reset"]);

  await assert.rejects(
    () =>
      processVideo(
        new FakeVideo(),
        { capabilities: { temporal: true }, async infer() {} },
        { strideMs: 66 },
      ),
    /temporal adapter requires reset/,
  );
});
