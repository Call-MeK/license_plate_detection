import io
from pathlib import Path
import runpy
import sys
import tempfile
from unittest.mock import Mock

import cv2
import numpy as np
import pytest

from src import config, pipeline


@pytest.mark.parametrize("failure", [None, "pipeline", "display"])
def test_uploaded_video_resources_are_cleaned_up(tmp_path, monkeypatch, failure):
    source = tmp_path / "source.avi"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"MJPG"), 5, (120, 80))
    assert writer.isOpened()
    try:
        writer.write(np.zeros((80, 120, 3), dtype=np.uint8))
    finally:
        writer.release()

    ui = Mock()
    ui.file_uploader.return_value = io.BytesIO(source.read_bytes())
    monkeypatch.setitem(sys.modules, "streamlit", ui)
    monkeypatch.setattr(config, "USE_STUB", True)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    # run_path executes the real entrypoint, which adds the repo to sys.path.
    monkeypatch.setattr(sys, "path", sys.path.copy())
    captures = []
    open_capture = cv2.VideoCapture

    def capture(path):
        video = open_capture(path)
        assert video.isOpened()
        captures.append((Path(path), video))
        return video

    monkeypatch.setattr(cv2, "VideoCapture", capture)
    if failure == "pipeline":
        monkeypatch.setattr(pipeline, "process_frame", Mock(side_effect=RuntimeError("processing failed")))
    elif failure == "display":
        ui.empty.return_value.image.side_effect = RuntimeError("display failed")

    entrypoint = Path(__file__).resolve().parents[1] / "app" / "main.py"
    try:
        if failure:
            with pytest.raises(RuntimeError, match="failed"):
                runpy.run_path(str(entrypoint), run_name="__main__")
        else:
            runpy.run_path(str(entrypoint), run_name="__main__")
            rows = ui.empty.return_value.dataframe.call_args.args[0]
            assert rows[0]["plate"] == "51F12345"
        assert len(captures) == 1
        path, video = captures[0]
        assert not video.isOpened()
        assert not path.exists()
    finally:
        for _, video in captures:
            video.release()
