export const CONTRACT_VERSION = 1;

export function normalizeBlendshapes(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  return Object.entries(value).map(([categoryName, score]) => ({ categoryName, score }));
}

export function neutralHeadEuler(value) {
  return value || { x: 0, y: 0, z: 0 };
}

export function blendshapeScores(value) {
  const scores = {};
  const blendshapes = normalizeBlendshapes(value);
  if (blendshapes) for (const c of blendshapes) scores[c.categoryName] = c.score;
  return scores;
}

export function hasOutput(frame) {
  const blendshapes = normalizeBlendshapes(frame?.blendshapes);
  const landmarks = frame?.landmarks;
  const hasLandmarks =
    (Array.isArray(landmarks) || ArrayBuffer.isView(landmarks)) && landmarks.length > 0;
  return !!(hasLandmarks || (blendshapes && blendshapes.length > 0) || frame?.headEuler);
}
