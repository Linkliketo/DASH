// GNM Phase 2：惰性资产加载、manifest/size/SHA 校验、IndexedDB 缓存。
// 不解析 mesh、不求解 identity/expression；这些属于 Phase 3-4。

export const GNM_MANIFEST_URL = "models/gnm/v3/manifest.json";
const DB_NAME = "dash-gnm";
const DB_VERSION = 1;
const STORE = "assets";
const BIN_CACHE_PREFIX = "gnm_head_v3:bin:";

export class GnmAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GnmAssetError";
    this.code = code;
  }
}

function abortError() {
  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  }
}

function assertAbort(signal) {
  if (signal?.aborted) throw abortError();
}

export async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) {
    throw new GnmAssetError("GNM_SHA_UNAVAILABLE", "浏览器不支持 SHA-256 校验");
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function assertAssetMeta(asset, label) {
  if (!asset || typeof asset.url !== "string" || !asset.url) {
    throw new GnmAssetError("GNM_MANIFEST_INVALID", `${label}.url 缺失`);
  }
  if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
    throw new GnmAssetError("GNM_MANIFEST_INVALID", `${label}.sizeBytes 无效`);
  }
  if (typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new GnmAssetError("GNM_MANIFEST_INVALID", `${label}.sha256 无效`);
  }
}

export function validateGnmManifest(manifest) {
  if (!manifest || manifest.schema !== "dash.gnm.web.v1") {
    throw new GnmAssetError("GNM_MANIFEST_INVALID", "GNM manifest schema 不匹配");
  }
  if (manifest.kind !== "gnm" || manifest.lazy !== true) {
    throw new GnmAssetError("GNM_MANIFEST_INVALID", "GNM manifest 必须声明 kind=gnm / lazy=true");
  }
  assertAssetMeta(manifest.assets?.bin, "assets.bin");
  assertAssetMeta(manifest.assets?.headJson, "assets.headJson");
  assertAssetMeta(manifest.assets?.correspondence, "assets.correspondence");
  return manifest;
}

function validateModelDocuments(headJson, correspondence) {
  const model = headJson?.model;
  if (!model || model.version !== "3.0" || model.variant !== "head") {
    throw new GnmAssetError("GNM_HEAD_JSON_INVALID", "gnm_head.json 模型标识不匹配");
  }
  if (model.vertexCount !== 17821 || model.jointCount !== 4) {
    throw new GnmAssetError("GNM_HEAD_JSON_INVALID", "gnm_head.json 顶点/关节数不匹配");
  }
  if (headJson?.correspondence?.count !== 473) {
    throw new GnmAssetError("GNM_HEAD_JSON_INVALID", "gnm_head.json correspondence.count 不是 473");
  }
  if (!headJson?.arrays || !headJson.arrays.template_vertex_positions) {
    throw new GnmAssetError("GNM_HEAD_JSON_INVALID", "gnm_head.json 缺少 arrays");
  }
  const count = correspondence?.landmark_indices?.length;
  if (count !== 473 ||
      correspondence?.vertex_indices?.length !== 473 ||
      correspondence?.rigid?.length !== 473 ||
      correspondence?.reference_landmarks?.length !== 473) {
    throw new GnmAssetError("GNM_CORRESPONDENCE_INVALID", "correspondence.json 数组长度不是 473");
  }
  const rigid = correspondence.rigid.filter(Boolean).length;
  if (rigid !== 166) {
    throw new GnmAssetError("GNM_CORRESPONDENCE_INVALID", `correspondence rigid 数量 ${rigid} != 166`);
  }
  return { count, rigid };
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("IndexedDB write failed")); };
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
}

async function fetchBlobAsset(asset, { signal, onProgress } = {}) {
  assertAbort(signal);
  const response = await fetch(asset.url, { cache: "no-cache", signal });
  if (!response.ok) throw new GnmAssetError("GNM_FETCH_FAILED", `${asset.url} HTTP ${response.status}`);
  const total = asset.sizeBytes || Number(response.headers.get("content-length")) || 0;
  const chunks = [];
  let received = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    for (;;) {
      assertAbort(signal);
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.({ phase: "download", received, total, fraction: total ? received / total : 0 });
    }
  } else {
    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    received = buffer.byteLength;
  }
  assertAbort(signal);
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (bytes.byteLength !== asset.sizeBytes) {
    throw new GnmAssetError("GNM_SIZE_MISMATCH", `${asset.url} size ${bytes.byteLength} != ${asset.sizeBytes}`);
  }
  const sha256 = await sha256Hex(bytes.buffer);
  if (sha256 !== asset.sha256) {
    throw new GnmAssetError("GNM_SHA_MISMATCH", `${asset.url} SHA-256 不匹配`);
  }
  onProgress?.({ phase: "verify", received, total, fraction: 1 });
  return new Blob([bytes], { type: "application/octet-stream" });
}

async function fetchJsonAsset(asset, { signal } = {}) {
  assertAbort(signal);
  const response = await fetch(asset.url, { cache: "no-cache", signal });
  if (!response.ok) throw new GnmAssetError("GNM_FETCH_FAILED", `${asset.url} HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  assertAbort(signal);
  if (buffer.byteLength !== asset.sizeBytes) {
    throw new GnmAssetError("GNM_SIZE_MISMATCH", `${asset.url} size ${buffer.byteLength} != ${asset.sizeBytes}`);
  }
  const sha256 = await sha256Hex(buffer);
  if (sha256 !== asset.sha256) {
    throw new GnmAssetError("GNM_SHA_MISMATCH", `${asset.url} SHA-256 不匹配`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new GnmAssetError("GNM_JSON_INVALID", `${asset.url} 不是有效 JSON`);
  }
}

async function readCachedBin(manifest, { signal } = {}) {
  try {
    const key = `${BIN_CACHE_PREFIX}${manifest.version}`;
    const record = await idbGet(key);
    if (!record?.blob || record.version !== manifest.version) return null;
    assertAbort(signal);
    if (record.blob.size !== manifest.assets.bin.sizeBytes) {
      await idbDelete(key);
      return null;
    }
    const buffer = await record.blob.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    if (sha256 !== manifest.assets.bin.sha256) {
      await idbDelete(key);
      return null;
    }
    return record.blob;
  } catch {
    return null;
  }
}

async function writeCachedBin(manifest, blob) {
  try {
    await idbPut(`${BIN_CACHE_PREFIX}${manifest.version}`, {
      version: manifest.version,
      sizeBytes: manifest.assets.bin.sizeBytes,
      sha256: manifest.assets.bin.sha256,
      blob,
      storedAt: new Date().toISOString(),
    });
  } catch {
    // Quota/IDB unavailable: still usable for this page lifetime.
  }
}

let inflight = null;
let lastLoad = null;

export async function loadGnmAssets({ signal, onProgress, force = false } = {}) {
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const t0 = performance.now();
    assertAbort(signal);
    onProgress?.({ phase: "manifest", fraction: 0 });
    const manifestResponse = await fetch(GNM_MANIFEST_URL, { cache: "no-cache", signal });
    if (!manifestResponse.ok) {
      throw new GnmAssetError("GNM_FETCH_FAILED", `GNM manifest HTTP ${manifestResponse.status}`);
    }
    const manifest = validateGnmManifest(await manifestResponse.json());
    assertAbort(signal);

    let binBlob = force ? null : await readCachedBin(manifest, { signal });
    const fromCache = !!binBlob;
    let binLoadMs = 0;
    if (!binBlob) {
      const binStart = performance.now();
      binBlob = await fetchBlobAsset(manifest.assets.bin, { signal, onProgress });
      binLoadMs = performance.now() - binStart;
      await writeCachedBin(manifest, binBlob);
    }
    assertAbort(signal);

    const headJson = await fetchJsonAsset(manifest.assets.headJson, { signal });
    const correspondence = await fetchJsonAsset(manifest.assets.correspondence, { signal });
    const shape = validateModelDocuments(headJson, correspondence);
    const binBuffer = await binBlob.arrayBuffer();
    assertAbort(signal);

    const result = {
      manifest,
      binBlob,
      binBuffer,
      headJson,
      correspondence,
      shape,
      fromCache,
      binLoadMs: Math.round(binLoadMs * 10) / 10,
      loadMs: Math.round((performance.now() - t0) * 10) / 10,
      version: manifest.version,
      sha256: manifest.assets.bin.sha256,
    };
    lastLoad = result;
    onProgress?.({ phase: "done", fraction: 1, fromCache, loadMs: result.loadMs });
    return result;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function getLastGnmLoad() {
  return lastLoad;
}

export async function clearGnmCache(version = "3.0.0") {
  await idbDelete(`${BIN_CACHE_PREFIX}${version}`);
}
