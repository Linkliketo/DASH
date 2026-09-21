"""Preview pairs.npz: numeric summary + an evidence figure.

Why a figure, not only shape checks:
    Shape checks pass even when features and labels are misaligned by a frame.
    Only looking at both together shows whether they describe the same moment.

Output:
    stdout : summary + PASS/FAIL checks
    file   : quant/result/pairs_preview.png
"""
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")                 # render to a file, never open a window
import matplotlib.pyplot as plt

# ---------- paths ----------
QUANT_DIR  = Path(r"D:\DASH\V0FastTest\quant")
PAIRS_PATH = QUANT_DIR / "data" / "pairs.npz"
RESULT_DIR = QUANT_DIR / "result"
FIG_PATH   = RESULT_DIR / "pairs_preview.png"

# ---------- dataset contract (must match collect_pairs.py) ----------
N_LANDMARKS = 478
N_FEATURES  = N_LANDMARKS * 3         # 1434
N_LABELS    = 52
MIN_SAMPLES = 1000

# ---------- display options ----------
N_SCATTER_FRAMES = 3                  # how many frames to overlay in the scatter
N_TOP_TRACES     = 5                  # how many blendshape curves to draw
N_TOP_LISTED     = 10                 # how many high-variance channels to print

# ARKit 52 blendshape names, in MediaPipe's output order (index == position)
BLENDSHAPE_NAMES = [
    "_neutral",          "browDownLeft",        "browDownRight",       "browInnerUp",
    "browOuterUpLeft",   "browOuterUpRight",    "cheekPuff",           "cheekSquintLeft",
    "cheekSquintRight",  "eyeBlinkLeft",        "eyeBlinkRight",       "eyeLookDownLeft",
    "eyeLookDownRight",  "eyeLookInLeft",       "eyeLookInRight",      "eyeLookOutLeft",
    "eyeLookOutRight",   "eyeLookUpLeft",       "eyeLookUpRight",      "eyeSquintLeft",
    "eyeSquintRight",    "eyeWideLeft",         "eyeWideRight",        "jawForward",
    "jawLeft",           "jawOpen",             "jawRight",            "mouthClose",
    "mouthDimpleLeft",   "mouthDimpleRight",    "mouthFrownLeft",      "mouthFrownRight",
    "mouthFunnel",       "mouthLeft",           "mouthLowerDownLeft",  "mouthLowerDownRight",
    "mouthPressLeft",    "mouthPressRight",     "mouthPucker",         "mouthRight",
    "mouthRollLower",    "mouthRollUpper",      "mouthShrugLower",     "mouthShrugUpper",
    "mouthSmileLeft",    "mouthSmileRight",     "mouthStretchLeft",    "mouthStretchRight",
    "mouthUpperUpLeft",  "mouthUpperUpRight",   "noseSneerLeft",       "noseSneerRight",
]


def load_pairs(path=PAIRS_PATH):
    """Load the dataset, or exit with a clear message if it is missing."""
    if not path.exists():
        sys.exit(f"dataset not found: {path}\n"
                 f"run  python -m quant.collect_pairs  first")
    with np.load(path) as d:
        return d["features"], d["labels"]


def check(X, Y):
    """Return a list of (name, passed) for the dataset contract."""
    return [
        ("samples matched",   X.shape[0] == Y.shape[0]),
        (f"X columns = {N_FEATURES}", X.shape[1] == N_FEATURES),
        (f"Y columns = {N_LABELS}",   Y.shape[1] == N_LABELS),
        ("dtype float32",     X.dtype == np.float32 and Y.dtype == np.float32),
        (f"samples >= {MIN_SAMPLES}", X.shape[0] >= MIN_SAMPLES),
        ("no NaN",            not (np.isnan(X).any() or np.isnan(Y).any())),
    ]


def report(X, Y):
    """Print the numeric summary."""
    print("=== summary ===")
    print(f"  X: shape={X.shape}  dtype={X.dtype}")
    print(f"  Y: shape={Y.shape}  dtype={Y.dtype}")

    n = X.shape[0]
    if n == 0:
        print("  no samples at all - nothing more to check")
        return None

    pts = X.reshape(n, N_LANDMARKS, 3)
    print(f"\n=== structure ===")
    print(f"  X.reshape(-1, {N_LANDMARKS}, 3) -> {pts.shape}"
          f"   (divisible, so {N_FEATURES} = {N_LANDMARKS}x3)")
    for i, axis in enumerate("xyz"):
        print(f"  {axis} range: [{pts[:, :, i].min():.4f}, {pts[:, :, i].max():.4f}]")
    print(f"  Y range: [{Y.min():.4f}, {Y.max():.4f}]"
          f"   (normalized coordinates may slightly exceed [0,1] near the frame edge)")

    print(f"\n=== checks ===")
    ok_all = True
    for name, ok in check(X, Y):
        ok_all &= ok
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")

    # which channels actually moved during the recording
    var = Y.std(axis=0)
    order = np.argsort(var)[::-1]
    print(f"\n=== {N_TOP_LISTED} most varying blendshapes"
          f" (non-zero means expressions were really performed) ===")
    for i in order[:N_TOP_LISTED]:
        print(f"  [{i:2d}] {BLENDSHAPE_NAMES[i]:18s} std={var[i]:.4f}  max={Y[:, i].max():.4f}")

    return order


def figure(X, Y, order, path=FIG_PATH):
    """Draw three panels: landmark scatter, blendshape traces, label histogram."""
    n = X.shape[0]
    pts = X.reshape(n, N_LANDMARKS, 3)

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))

    # --- panel 1: landmarks (must look like a face) ---
    idx = np.linspace(0, n - 1, min(N_SCATTER_FRAMES, n)).astype(int)
    for i in idx:
        axes[0].scatter(pts[i, :, 0], -pts[i, :, 1], s=1, alpha=0.4, label=f"frame {i}")
    axes[0].set_title("landmarks (x vs -y)\nshould look like a face")
    axes[0].set_aspect("equal")
    axes[0].legend(fontsize=7)

    # --- panel 2: blendshape traces (must vary over time) ---
    for i in order[:N_TOP_TRACES]:
        axes[1].plot(Y[:, i], lw=1, label=BLENDSHAPE_NAMES[i])
    axes[1].set_title(f"top-{N_TOP_TRACES} varying blendshapes over time")
    axes[1].set_xlabel("frame")
    axes[1].legend(fontsize=7)

    # --- panel 3: label distribution (should be long-tailed) ---
    axes[2].hist(Y.ravel(), bins=60)
    axes[2].set_title("all label values")
    axes[2].set_yscale("log")

    plt.tight_layout()
    plt.savefig(path, dpi=80)
    plt.close(fig)
    return path


def main():
    X, Y = load_pairs()
    order = report(X, Y)
    if order is None:
        return
    out = figure(X, Y, order)
    print(f"\nfigure saved: {out}")


if __name__ == "__main__":
    main()
