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


def test_face_frame_with_pose_and_hands():
    pose_img = np.random.default_rng(1).random((33, 4), dtype=np.float32)
    pose_world = np.random.default_rng(2).random((33, 4), dtype=np.float32)
    hand_l = np.random.default_rng(3).random((21, 3), dtype=np.float32)
    msg = build_face_frame(
        np.zeros(52, dtype=np.float32),
        pose_image=pose_img,
        pose_world=pose_world,
        hand_left=hand_l,
        hand_right=None,
    )
    assert len(msg["pose"]["image"]) == 132
    assert len(msg["pose"]["world"]) == 132
    assert len(msg["hands"]["left"]) == 63
    assert msg["hands"]["right"] is None
    with pytest.raises(ValueError):
        build_face_frame(np.zeros(52, dtype=np.float32), pose_image=np.zeros((10, 4)))


def test_face_frame_omits_body_sections_by_default():
    msg = build_face_frame(np.zeros(52, dtype=np.float32))
    assert "pose" not in msg and "hands" not in msg, "A 版本消息不应带 pose/hands 段"


def test_build_face_frame_matches_viewer_contract():
    msg = build_face_frame(np.zeros(NUM_BLENDSHAPES, dtype=np.float32),
                           pts=1.5, head_euler={"x": 1, "y": 2, "z": 3})
    assert msg["type"] == FRAME_TYPE == "miniface-frame", "fusion/server.mjs routes on this string"
    assert msg["pts"] == 1.5
    assert len(msg["blendshapes"]) == NUM_BLENDSHAPES
    assert msg["headEuler"] == {"x": 1.0, "y": 2.0, "z": 3.0}
