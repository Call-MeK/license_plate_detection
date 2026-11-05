from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from src import config, ocr, pipeline


def _box(x):
    return [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]]


@pytest.fixture
def recognize(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    mock = Mock()
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(recognize=mock))
    return mock


def test_wide_crop_is_read_as_one_line(recognize):
    recognize.return_value = [(_box(0), "51F-123.45", 0.7)]
    crop = np.full((40, 160, 3), (20, 40, 60), dtype=np.uint8)

    lines, confidence = ocr.read_plate_lines(crop)

    assert (lines, confidence) == (["51F-123.45"], pytest.approx(0.7))
    recognize.assert_called_once()
    gray = recognize.call_args.args[0]
    assert gray.shape == (40, 160)
    assert recognize.call_args.kwargs["allowlist"] == "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    assert recognize.call_args.kwargs["detail"] == 1


def test_square_crop_is_split_into_two_lines(recognize):
    recognize.side_effect = [[(_box(0), "59-A1", 0.6)], [(_box(0), "123.45", 0.8)]]

    lines, confidence = ocr.read_plate_lines(np.zeros((80, 100, 3), dtype=np.uint8))

    assert lines == ["59-A1", "123.45"]
    assert confidence == pytest.approx(0.7)
    assert recognize.call_count == 2
    assert [call.args[0].shape for call in recognize.call_args_list] == [(40, 100), (40, 100)]


def test_split_passes_top_rows_then_bottom_rows(recognize):
    recognize.return_value = []
    crop = np.zeros((81, 100, 3), dtype=np.uint8)
    crop[:40] = 50
    crop[40:] = 200

    ocr.read_plate_lines(crop)

    top, bottom = (call.args[0] for call in recognize.call_args_list[:2])
    assert top.shape == (40, 100) and bottom.shape == (41, 100)
    assert top.max() == 50 and bottom.min() == 200


def test_pieces_are_joined_left_to_right(recognize):
    recognize.return_value = [(_box(70), "I23.45", 0.8), (_box(5), "5lF", 0.6)]

    lines, confidence = ocr.read_plate_lines(np.zeros((40, 160, 3), dtype=np.uint8))

    assert lines == ["5LFI23.45"]
    assert confidence == pytest.approx(0.7)


def test_no_text_returns_empty(recognize):
    recognize.return_value = []

    assert ocr.read_plate_lines(np.zeros((40, 160, 3), dtype=np.uint8)) == ([], 0.0)


def test_empty_half_returns_remaining_line(recognize, monkeypatch):
    recognize.side_effect = [[], [(_box(0), "12345", 0.8)], []]  # lần 3: đọc lại cả crop, không ra chữ
    crop = np.zeros((80, 100, 3), dtype=np.uint8)

    lines, confidence = ocr.read_plate_lines(crop)

    assert (lines, confidence) == (["12345"], pytest.approx(0.8))
    monkeypatch.setattr(pipeline, "detect_plates", Mock(return_value=[(0, 0, 100, 80, 0.9)]))
    monkeypatch.setattr(pipeline, "read_plate_lines", Mock(return_value=(lines, confidence)))
    _, observations = pipeline.process_frame(np.zeros((80, 100, 3), dtype=np.uint8))
    assert observations[0]["valid"] is False


def test_read_plate_formats_cleaned_lines(recognize):
    recognize.side_effect = [[(_box(0), "59-A1", 0.6)], [(_box(0), "I23.45", 0.8)]]

    text, confidence = ocr.read_plate(np.zeros((80, 100, 3), dtype=np.uint8))

    assert text == "59A1-123.45"
    assert confidence == pytest.approx(0.7)


def test_read_plate_without_text(recognize):
    recognize.return_value = []

    assert ocr.read_plate(np.zeros((40, 160, 3), dtype=np.uint8)) == ("", 0.0)


def test_stub_mode_keeps_contract(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", True)
    crop = np.zeros((40, 160, 3), dtype=np.uint8)

    assert ocr.read_plate_lines(crop) == (["51F12345"], 0.80)
    assert ocr.read_plate(crop) == ("51F-123.45", 0.80)


def test_invalid_split_retries_whole_crop_as_one_line(recognize):
    # biển 1 dòng bị nghiêng nên tỉ lệ khung < ONE_LINE_MIN_RATIO và bị cắt đôi
    recognize.side_effect = [[(_box(0), "5IF", 0.4)], [(_box(0), "X2", 0.3)],
                             [(_box(0), "51F-123.45", 0.7)]]
    crop = np.zeros((60, 160, 3), dtype=np.uint8)

    lines, confidence = ocr.read_plate_lines(crop)

    assert lines == ["51F-123.45"]
    assert ocr.clean_lines(lines) == ["51F12345"]
    assert confidence == pytest.approx(0.7)
    assert recognize.call_count == 3
    assert recognize.call_args_list[2].args[0].shape == (60, 160)


def test_invalid_split_keeps_two_lines_when_retry_is_invalid(recognize):
    recognize.side_effect = [[(_box(0), "59-A1", 0.6)], [(_box(0), "12", 0.8)],
                             [(_box(0), "XYZ", 0.9)]]

    lines, confidence = ocr.read_plate_lines(np.zeros((80, 100, 3), dtype=np.uint8))

    assert (lines, confidence) == (["59-A1", "12"], pytest.approx(0.7))
    assert recognize.call_count == 3


def test_valid_two_line_read_does_not_retry(recognize):
    recognize.side_effect = [[(_box(0), "59-A1", 0.6)], [(_box(0), "123.45", 0.8)]]

    lines, _ = ocr.read_plate_lines(np.zeros((80, 100, 3), dtype=np.uint8))

    assert lines == ["59-A1", "123.45"]
    assert recognize.call_count == 2
