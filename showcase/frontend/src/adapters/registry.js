import { CONTRACT_VERSION } from "./adapter.js?v=14";

const DEFAULT_MANIFEST_URL = "models/manifest.json";
const SUPPORTED_OUTPUT_SCHEMAS = new Set(["canonical-face-v1"]);

export function validateAdapter(adapter, entry) {
  if (!adapter || adapter.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`model ${entry.name} uses unsupported contract version: ${adapter?.contractVersion}`);
  }
  for (const method of ["init", "infer", "close"]) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`model ${entry.name} adapter is missing ${method}()`);
    }
  }
  if (!adapter.capabilities || typeof adapter.capabilities !== "object") {
    throw new Error(`model ${entry.name} adapter is missing capabilities`);
  }
  if (entry.outputSchema && !SUPPORTED_OUTPUT_SCHEMAS.has(entry.outputSchema)) {
    throw new Error(`model ${entry.name} uses unsupported output schema: ${entry.outputSchema}`);
  }
  return adapter;
}

export function normalizeKind(entry) {
  const kind = entry.kind || (entry.name === "face_landmarker" ? "mediapipe-task" : "module");
  // 兼容旧 manifest / 旧 IndexedDB 缓存里的 perception 别名
  return kind === "perception" ? "mediapipe-task" : kind;
}

export async function loadManifest(url = DEFAULT_MANIFEST_URL) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`manifest download failed: HTTP ${resp.status}`);
  return resp.json();
}

export async function createAdapter(entry, options = {}) {
  if (!entry) throw new Error("model entry is required");

  const kind = normalizeKind(entry);

  if (kind === "mediapipe-task") {
    const { createMediaPipeAdapter } = await import("./mediapipeAdapter.js?v=14");
    return validateAdapter(createMediaPipeAdapter(entry, options), entry);
  }

  if (kind === "module") {
    if (!entry.module) throw new Error(`model ${entry.name} has no module`);
    const url = new URL(entry.module, document.baseURI);
    if (url.origin !== location.origin) {
      throw new Error("model module must be same-origin");
    }
    const mod = await import(url.href);
    if (typeof mod.createAdapter !== "function") {
      throw new Error(`model ${entry.name} module has no createAdapter`);
    }
    return validateAdapter(mod.createAdapter(entry, options), entry);
  }

  throw new Error(`unsupported model kind: ${kind}`);
}
