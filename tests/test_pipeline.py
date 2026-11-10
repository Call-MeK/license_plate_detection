from unittest.mock import Mock

import numpy as np
import pytest

from src import pipeline


@pytest.fixture
def frame():
    image = np.zeros((80, 120, 3), dtype=np.uint8)
    image[:] = (20, 40, 60)  # Distinct BGR channels expose accidental conversion.
    return image


@pytest.fixture
def stages(monkeypatch):
    detector = Mock(return_value=[(10, 25, 90, 60, 0.91)])
    ocr = Mock(return_value=(["51F-123.45"], 0.82))
    monkeypatch.setattr(pipeline, "detect_plates", detector)
    monkeypatch.setattr(pipeline, "read_plate_lines", ocr)
    return detector, ocr


def test_annotations_leave_input_unchanged(frame, stages):
    before = frame.copy()

    annotated, _ = pipeline.process_frame(frame)

    np.testing.assert_array_equal(frame, before)
    assert not np.shares_memory(annotated, frame)
    assert annotated.shape == frame.shape
    assert annotated.dtype == frame.dtype
    assert np.any(annotated != before)
    np.testing.assert_array_equal(annotated[-1, -1], (20, 40, 60))
    detector, ocr = stages
    detector.assert_called_once()
    np.testing.assert_array_equal(detector.call_args.args[0], before + 30)
    ocr.assert_called_once()
    np.testing.assert_array_equal(ocr.call_args.args[0], before[25:60, 10:90] + 30)


@pytest.mark.parametrize(
    "raw_lines,confidence,lines,plate,display,valid",
    [
        (["5lF-I23.45"], 0.82, ["51F12345"], "51F12345", "51F-123.45", True),
        (["59A1-123.45"], 0.73, ["59A112345"], "59A112345", "59A1-123.45", True),
        (["59-A1", "I23.45"], 0.7, ["59A1", "12345"], "59A112345", "59A1-123.45", True),
        (["???"], 0.10, [], "", "", False),
        (["ABC"], 0.30, ["ABC"], "ABC", "ABC", False),
        ([], 0.0, [], "", "", False),
    ],
)
def test_observation_fields(frame, stages, raw_lines, confidence, lines, plate, display, valid):
    _, ocr = stages
    ocr.return_value = (raw_lines, confidence)

    _, observations = pipeline.process_frame(frame)

    assert observations == [{
        "lines": lines,
        "plate": plate,
        "display_plate": display,
        "ocr_confidence": confidence,
        "detector_confidence": 0.91,
        "bbox": (10, 25, 90, 60),
        "valid": valid,
    }]


def test_empty_detections_return_empty_list_and_copy(frame, stages):
    detector, ocr = stages
    detector.return_value = []

    annotated, observations = pipeline.process_frame(frame)

    assert observations == []
    ocr.assert_not_called()
    np.testing.assert_array_equal(annotated, frame)
    assert not np.shares_memory(annotated, frame)


def test_clips_boxes_before_ocr_and_skips_empty_boxes(frame, stages):
    detector, ocr = stages
    detector.return_value = [
        (-10, -5, 130, 85, 0.93),
        (-20, 5, -1, 20, 0.9),
        (121, 5, 140, 20, 0.9),
        (5, -20, 20, -1, 0.9),
        (5, 81, 20, 100, 0.9),
        (10, 10, 10, 20, 0.9),
        (10, 10, 20, 10, 0.9),
        (20, 20, 10, 10, 0.9),
    ]
    before = frame.copy()

    _, observations = pipeline.process_frame(frame)

    assert len(observations) == 1
    assert observations[0]["bbox"] == (0, 0, 120, 80)
    assert observations[0]["detector_confidence"] == 0.93
    ocr.assert_called_once()
    np.testing.assert_array_equal(ocr.call_args.args[0], before + 30)


def test_only_largest_clipped_detection_is_read(frame, stages):
    detector, ocr = stages
    detector.return_value = [(20, 30, 100, 70, 0.72), (10, 25, 90, 60, 0.91), (-50, 0, 10, 10, 0.99)]
    before = frame.copy()
    crops = []

    def read_crop(crop):
        crops.append(crop.copy())
        return [(["51F-123.45"], 0.82), (["59A1-123.45"], 0.64)][len(crops) - 1]

    ocr.side_effect = read_crop

    _, observations = pipeline.process_frame(frame)

    assert len(crops) == 1
    np.testing.assert_array_equal(crops[0], before[30:70, 20:100] + 30)
    assert observations[0]["bbox"] == (20, 30, 100, 70)
    assert observations[0]["plate"] == "51F12345"


def test_equal_size_detections_prefer_detector_confidence(frame, stages):
    detector, ocr = stages
    detector.return_value = [(0, 0, 20, 10, .4), (20, 0, 40, 10, .9)]
    _, observations = pipeline.process_frame(frame)
    assert observations[0]["bbox"] == (20, 0, 40, 10)
    ocr.assert_called_once()


def test_process_frame_fills_timings(frame, stages):
    timings = {}

    pipeline.process_frame(frame, timings=timings)

    assert timings.keys() >= {"detect_ms", "ocr_ms"}
    assert all(value >= 0 for value in timings.values())
