import { CONTRACT_VERSION } from "./adapter.js?v=9";

const DEFAULT_MANIFEST_URL = "models/manifest.json";
const SUPPORTED_OUTPUT_SCHEMAS = new Set(["canonical-face-v1"]);

function validateAdapter(adapter, entry) {
  if (adapter.contractVersion !== CONTRACT_VERSION) {
    throw new Error(`model ${entry.name} uses unsupported contract version: ${adapter.contractVersion}`);
  }
  if (entry.outputSchema && !SUPPORTED_OUTPUT_SCHEMAS.has(entry.outputSchema)) {
    throw new Error(`model ${entry.name} uses unsupported output schema: ${entry.outputSchema}`);
  }
  return adapter;
}

export async function loadManifest(url = DEFAULT_MANIFEST_URL) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`manifest download failed: HTTP ${resp.status}`);
  return resp.json();
}

export async function createAdapter(entry, options = {}) {
  if (!entry) throw new Error("model entry is required");

  const kind = entry.kind || (entry.name === "face_landmarker" ? "mediapipe-task" : "module");

  if (kind === "mediapipe-task") {
    const { createMediaPipeAdapter } = await import("./mediapipeAdapter.js?v=9");
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
