"""PLATE_MODEL auto-selection (ONNX before PT) and YOLO call arguments."""
import sys
from types import SimpleNamespace

from src import config, detector


def test_prefers_onnx_when_present(tmp_path):
    (tmp_path / "models").mkdir()
    onnx = tmp_path / "models" / "plate_detector.onnx"
    onnx.write_bytes(b"onnx")
    (tmp_path / "models" / "plate_detector.pt").write_bytes(b"pt")
    assert config.resolve_plate_model(None, tmp_path) == onnx


def test_falls_back_to_pt(tmp_path):
    (tmp_path / "models").mkdir()
    pt = tmp_path / "models" / "plate_detector.pt"
    pt.write_bytes(b"pt")
    assert config.resolve_plate_model(None, tmp_path) == pt


def test_env_value_wins(tmp_path):
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "plate_detector.onnx").write_bytes(b"onnx")
    explicit = tmp_path / "custom.pt"
    assert config.resolve_plate_model(str(explicit), tmp_path) == explicit
    assert config.resolve_plate_model("custom.pt", tmp_path) == tmp_path / "custom.pt"


def test_empty_env_value_falls_back_to_auto_selection(tmp_path):
    (tmp_path / "models").mkdir()
    onnx = tmp_path / "models" / "plate_detector.onnx"
    onnx.write_bytes(b"onnx")
    assert config.resolve_plate_model("", tmp_path) == onnx
    assert config.resolve_plate_model("   ", tmp_path) == onnx
    onnx.unlink()
    pt = tmp_path / "models" / "plate_detector.pt"
    pt.write_bytes(b"pt")
    assert config.resolve_plate_model("", tmp_path) == pt


def test_detector_passes_imgsz_and_task(monkeypatch, tmp_path):
    weights = tmp_path / "plate_detector.onnx"
    weights.write_bytes(b"onnx")
    calls = {}

    class FakeYOLO:
        def __init__(self, path, task=None):
            calls["init"] = (path, task)

        def predict(self, frame, **kwargs):
            calls["predict"] = kwargs
            empty = SimpleNamespace(tolist=lambda: [])
            return [SimpleNamespace(boxes=SimpleNamespace(xyxy=empty, conf=empty))]

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=FakeYOLO))
    monkeypatch.setattr(detector, "_model", None)
    monkeypatch.setattr(config, "PLATE_MODEL", weights)
    monkeypatch.setattr(config, "USE_STUB", False)

    assert detector.detect_plates(None) == []
    assert calls["init"] == (str(weights), "detect")
    assert calls["predict"]["imgsz"] == 640
    assert calls["predict"]["conf"] == config.DET_CONF
    monkeypatch.setattr(detector, "_model", None)
