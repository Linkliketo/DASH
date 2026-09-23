import pytest

from showcase.backend import perception
from showcase.backend.perception.mediapipe_backend import DEFAULT_MODEL_PATH


def test_list_backends_contains_both():
    names = [i.name for i in perception.list_backends()]
    assert "mediapipe-task" in names
    assert "onnx-distilled" in names


def test_mediapipe_availability_matches_model_file():
    infos = {i.name: i for i in perception.list_backends()}
    assert infos["mediapipe-task"].available == DEFAULT_MODEL_PATH.is_file()
    if not DEFAULT_MODEL_PATH.is_file():
        assert infos["mediapipe-task"].reason, "unavailable backend must explain why"


def test_unknown_backend_raises_keyerror():
    with pytest.raises(KeyError):
        perception.create_backend("does-not-exist")


def test_unavailable_backend_raises_runtimeerror():
    # onnx 模型文件还不存在（Task 6 未完成），必须报不可用而不是莫名崩溃
    with pytest.raises(RuntimeError, match="unavailable"):
        perception.create_backend("onnx-distilled", onnx_path="no/such/model.onnx")
