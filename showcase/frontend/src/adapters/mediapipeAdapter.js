import { createFaceLandmarker, toFrame } from "../perception.js?v=14";
import { ensureModel, blobToBuffer } from "../modelstore.js?v=14";
import { CONTRACT_VERSION } from "./adapter.js?v=14";

const CAPABILITIES = Object.freeze({
  landmarks: 478,
  blendshapes: 52,
  headEuler: true,
  mesh: true,
  temporal: true,
});

function isVideoInput(input) {
  return typeof HTMLVideoElement !== "undefined" && input instanceof HTMLVideoElement;
}

function sourceAspect(input) {
  const width = input?.videoWidth ?? input?.width ?? input?.naturalWidth;
  const height = input?.videoHeight ?? input?.height ?? input?.naturalHeight;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : null;
}

export function createMediaPipeAdapter(entry) {
  return new MediaPipeAdapter(entry);
}

class MediaPipeAdapter {
  constructor(entry) {
    this.entry = entry;
    this.id = entry.id || entry.name;
    this.version = entry.version;
    this.contractVersion = CONTRACT_VERSION;
    this.capabilities = CAPABILITIES;
    this.modelBuffer = null;
    this.videoLm = null;
    this.imageLm = null;
  }

  async init({ onProgress } = {}) {
    this.close();
    const { blob, fromCache } = await ensureModel(this.entry.name, onProgress);
    const buffer = await blobToBuffer(blob);
    const videoLm = await createFaceLandmarker(buffer, "VIDEO");
    try {
      const imageLm = await createFaceLandmarker(buffer, "IMAGE");
      this.modelBuffer = buffer;
      this.videoLm = videoLm;
      this.imageLm = imageLm;
      return { fromCache };
    } catch (error) {
      videoLm.close();
      throw error;
    }
  }

  async reset() {
    if (!this.modelBuffer) return;
    const videoLm = await createFaceLandmarker(this.modelBuffer, "VIDEO");
    try {
      const imageLm = await createFaceLandmarker(this.modelBuffer, "IMAGE");
      const previousVideo = this.videoLm;
      const previousImage = this.imageLm;
      this.videoLm = videoLm;
      this.imageLm = imageLm;
      previousVideo?.close();
      previousImage?.close();
    } catch (error) {
      videoLm.close();
      throw error;
    }
  }

  async infer(input, timestampMs) {
    if (!this.videoLm || !this.imageLm) {
      throw new Error("MediaPipe adapter is not initialized");
    }
    const result = isVideoInput(input)
      ? this.videoLm.detectForVideo(input, timestampMs)
      : this.imageLm.detect(input);
    return toFrame(result, sourceAspect(input));
  }

  async inferVideo(input, timestampMs) {
    if (!this.videoLm) {
      throw new Error("MediaPipe adapter is not initialized");
    }
    return toFrame(this.videoLm.detectForVideo(input, timestampMs), sourceAspect(input));
  }

  close() {
    this.videoLm?.close();
    this.imageLm?.close();
    this.videoLm = null;
    this.imageLm = null;
    this.modelBuffer = null;
  }
}
