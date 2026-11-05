from unittest.mock import Mock

import numpy as np

from src import config, pipeline


def test_warm_up_is_noop_in_stub_mode(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", True)
    detect = Mock()
    read = Mock()
    monkeypatch.setattr(pipeline, "detect_plates", detect)
    monkeypatch.setattr(pipeline, "read_plate_lines", read)
    pipeline.warm_up()
    detect.assert_not_called()
    read.assert_not_called()


def test_warm_up_runs_each_model_once_with_expected_shapes(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    detect = Mock(return_value=[])
    read = Mock(return_value=([], 0.0))
    monkeypatch.setattr(pipeline, "detect_plates", detect)
    monkeypatch.setattr(pipeline, "read_plate_lines", read)
    pipeline.warm_up()
    detect.assert_called_once()
    read.assert_called_once()
    frame = detect.call_args.args[0]
    crop = read.call_args.args[0]
    assert frame.shape == (720, 1280, 3) and frame.dtype == np.uint8
    assert crop.shape == (50, 200, 3) and crop.dtype == np.uint8
