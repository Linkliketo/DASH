import numpy as np
import pytest

from showcase.backend.contract import (
    BLENDSHAPE_NAMES,
    FRAME_TYPE,
    NUM_BLENDSHAPES,
    array_to_categories,
    blendshapes_to_array,
    build_face_frame,
)


def test_blendshape_names_are_arkit_52():
    assert len(BLENDSHAPE_NAMES) == 52
    assert len(set(BLENDSHAPE_NAMES)) == 52, "names must be unique"
    for expected in ("_neutral", "jawOpen", "eyeBlinkLeft", "mouthSmileRight", "noseSneerLeft"):
        assert expected in BLENDSHAPE_NAMES


def test_array_to_categories_shape_and_keys():
    cats = array_to_categories(np.zeros(NUM_BLENDSHAPES, dtype=np.float32))
    assert len(cats) == NUM_BLENDSHAPES
    assert set(cats[0].keys()) == {"categoryName", "score"}, "viewer expects camelCase categoryName"
    assert cats[0]["categoryName"] == "_neutral"
    assert isinstance(cats[0]["score"], float)


def test_array_to_categories_rejects_wrong_length():
    with pytest.raises(ValueError):
        array_to_categories(np.zeros(51, dtype=np.float32))


def test_array_roundtrip():
    rng = np.random.default_rng(0)
    arr = rng.random(NUM_BLENDSHAPES, dtype=np.float32)
    back = blendshapes_to_array(array_to_categories(arr))
    np.testing.assert_allclose(back, arr, atol=1e-6)


def test_blendshapes_to_array_from_mediapipe_like_objects():
    class FakeCategory:
        def __init__(self, name, score):
            self.category_name = name
            self.score = score

    arr = blendshapes_to_array([FakeCategory("jawOpen", 0.75), FakeCategory("not-a-name", 9.9)])
    assert arr[BLENDSHAPE_NAMES.index("jawOpen")] == pytest.approx(0.75)
    assert arr.sum() == pytest.approx(0.75), "unknown names must be dropped"


def test_build_face_frame_matches_viewer_contract():
    msg = build_face_frame(np.zeros(NUM_BLENDSHAPES, dtype=np.float32),
                           pts=1.5, head_euler={"x": 1, "y": 2, "z": 3})
    assert msg["type"] == FRAME_TYPE == "miniface-frame", "fusion/server.mjs routes on this string"
    assert msg["pts"] == 1.5
    assert len(msg["blendshapes"]) == NUM_BLENDSHAPES
    assert msg["headEuler"] == {"x": 1.0, "y": 2.0, "z": 3.0}
