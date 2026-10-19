"""Real inference must use explicitly prepared local assets without downloading."""
from types import SimpleNamespace
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from src import config, detector, ocr


def test_config_loads_dotenv_before_reading_model_settings(tmp_path):
    copied_config = tmp_path / "src" / "config.py"
    copied_config.parent.mkdir()
    copied_config.write_text(Path(config.__file__).read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / ".env").write_text(
        "USE_STUB=false\nPLATE_MODEL=offline-detector.pt\nOCR_MODEL_DIR=offline-ocr\n", encoding="utf-8")
    environment = os.environ.copy()
    for key in ("USE_STUB", "PLATE_MODEL", "OCR_MODEL_DIR"):
        environment.pop(key, None)
    script = ("import json,runpy,sys; c=runpy.run_path(sys.argv[1]); "
              "print(json.dumps([c['USE_STUB'],str(c['PLATE_MODEL']),str(c['OCR_MODEL_DIR'])]))")
    result = subprocess.run([sys.executable, "-c", script, str(copied_config)],
                            cwd=tmp_path, env=environment, text=True, capture_output=True, check=True)
    assert json.loads(result.stdout) == [False, "offline-detector.pt", "offline-ocr"]


def test_missing_detector_weights_fail_before_loading_or_downloading(monkeypatch, tmp_path):
    monkeypatch.setattr(detector, "_model", None)
    monkeypatch.setattr(config, "PLATE_MODEL", tmp_path / "missing.pt")
    with pytest.raises(FileNotFoundError):
        detector._load()


def test_easyocr_uses_offline_cache_and_disables_downloads(monkeypatch, tmp_path):
    monkeypatch.setattr(ocr, "_reader", None)
    monkeypatch.setattr(config, "OCR_MODEL_DIR", tmp_path, raising=False)
    def offline_reader(languages, **options):
        assert languages == ["en"]
        assert options["gpu"] is False
        assert options["download_enabled"] is False
        assert options["model_storage_directory"] == str(tmp_path)
        return SimpleNamespace(readtext=lambda image: [])
    monkeypatch.setitem(sys.modules, "easyocr", SimpleNamespace(Reader=offline_reader))
    assert ocr._load().readtext(None) == []
