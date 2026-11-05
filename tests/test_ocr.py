from types import SimpleNamespace
from unittest.mock import Mock
import sys

import numpy as np
import pytest

from src import config, ocr


def part(x, y, text, confidence=.9, width=35, height=16):
    return ([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], text, confidence)


def test_two_lines_are_detected_from_boxes_even_on_wide_crop(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    reader = Mock(return_value=[part(8, 45, "12345"), part(10, 5, "59A1")])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    assert ocr.read_plate(np.zeros((80, 240, 3), dtype=np.uint8))[0] == "59A1-123.45"


def test_slanted_one_line_boxes_are_read_left_to_right(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    reader = Mock(return_value=[part(80, 0, "12345"), part(5, 8, "51F")])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    assert ocr.read_plate(np.zeros((60, 200, 3), dtype=np.uint8))[0] == "51F-123.45"


def test_original_is_read_once_with_allowlist_when_confident(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    reader = Mock(return_value=[part(0, 0, "51F12345")])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    image = np.zeros((40, 140, 3), dtype=np.uint8)
    assert ocr.read_plate(image) == ("51F-123.45", .9)
    assert reader.call_count == 1
    assert reader.call_args.args[0] is image
    assert reader.call_args.kwargs["allowlist"] == "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-."


def test_small_low_contrast_crop_retries_and_uses_valid_result(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(config, "OCR_RETRY_PREPROCESS", True, raising=False)
    reader = Mock(side_effect=[[part(0, 0, "51F1234", .4)], [part(0, 0, "51F12345", .7)]])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    image = np.full((20, 90, 3), 120, dtype=np.uint8)
    before = image.copy()
    assert ocr.read_plate(image) == ("51F-123.45", .7)
    assert reader.call_count == 2
    assert reader.call_args_list[0].args[0] is image
    assert reader.call_args_list[1].args[0].shape[0] > image.shape[0]
    np.testing.assert_array_equal(image, before)


def test_invalid_retry_cannot_replace_valid_original(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(config, "OCR_RETRY_PREPROCESS", True, raising=False)
    reader = Mock(side_effect=[[part(0, 0, "51F12345", .4)], [part(0, 0, "51F1234", .99)]])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    assert ocr.read_plate(np.zeros((20, 90, 3), dtype=np.uint8)) == ("51F-123.45", .4)


def test_retry_can_be_disabled_and_missing_characters_stay_invalid(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(config, "OCR_RETRY_PREPROCESS", False, raising=False)
    reader = Mock(return_value=[part(0, 0, "51F1234", .99)])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    text, _ = ocr.read_plate(np.zeros((20, 90, 3), dtype=np.uint8))
    assert not ocr.is_valid(ocr.clean_plate(text))
    assert reader.call_count == 1


def test_empty_results_return_empty_without_inventing_a_plate(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(config, "OCR_RETRY_PREPROCESS", True)
    reader = Mock(return_value=[])
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=reader))
    assert ocr.read_plate(np.zeros((20, 90, 3), dtype=np.uint8)) == ("", 0.0)
    assert reader.call_count == 2


def test_empty_crop_does_not_load_reader(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(ocr, "_load", Mock(side_effect=AssertionError("must not load")))
    assert ocr.read_plate(np.empty((0, 0, 3), dtype=np.uint8)) == ("", 0.0)


def test_threshold_variant_is_available_for_comparison(monkeypatch):
    monkeypatch.setattr(config, "OCR_RETRY_VARIANT", "threshold")
    crop = np.tile(np.arange(80, dtype=np.uint8), (20, 1))
    result = ocr._preprocess(crop)
    assert result.shape[0] > crop.shape[0]
    assert set(np.unique(result)) <= {0, 255}


def test_preprocessing_increases_low_contrast_without_mutating_crop(monkeypatch):
    monkeypatch.setattr(config, "OCR_RETRY_VARIANT", "auto")
    crop = np.tile(np.arange(110, 130, dtype=np.uint8), (20, 5))
    before = crop.copy()
    enhanced = ocr._preprocess(crop)
    assert enhanced.std() > crop.std()
    np.testing.assert_array_equal(crop, before)


def test_stub_does_not_load_ocr(monkeypatch):
    monkeypatch.setattr(config, "USE_STUB", True)
    monkeypatch.setattr(ocr, "_load", Mock(side_effect=AssertionError("must not load")))
    assert ocr.read_plate(np.zeros((10, 20, 3), dtype=np.uint8)) == ("51F-123.45", .80)


def test_reader_is_cached_and_offline(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(config, "OCR_MODEL_DIR", tmp_path)
    monkeypatch.setattr(ocr, "_reader", None)
    reader = SimpleNamespace(readtext=Mock(return_value=[part(0, 0, "51F12345")]))
    create = Mock(return_value=reader)
    monkeypatch.setitem(sys.modules, "easyocr", SimpleNamespace(Reader=create))
    crop = np.zeros((40, 140, 3), dtype=np.uint8)
    ocr.read_plate(crop)
    ocr.read_plate(crop)
    create.assert_called_once_with(["en"], gpu=False, download_enabled=False, model_storage_directory=str(tmp_path))


@pytest.mark.parametrize(
    "shape,parts,expected",
    [
        ((40, 160, 3), [
            ([[80, 5], [150, 5], [150, 30], [80, 30]], "I23.45", 0.8),
            ([[5, 5], [70, 5], [70, 30], [5, 30]], "5lF", 0.6),
        ], ("51F-123.45", 0.7)),
        ((80, 100, 3), [
            ([[0, 50], [90, 50], [90, 70], [0, 70]], "12345", 0.8),
            ([[10, 5], [90, 5], [90, 25], [10, 25]], "59A1", 0.6),
        ], ("59A1-123.45", 0.7)),
        ((40, 160, 3), [], ("", 0.0)),
    ],
)
def test_ocr_preserves_line_order_normalization_and_confidence(monkeypatch, shape, parts, expected):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=Mock(return_value=parts)))

    text, confidence = ocr.read_plate(np.zeros(shape, dtype=np.uint8))

    assert text == expected[0]
    assert confidence == pytest.approx(expected[1])


@pytest.mark.parametrize("raw,expected", [
    ("518-123.45", "51B-123.45"),
    ("516-123.45", "51G-123.45"),
    ("591-123.45", "59I-123.45"),
    ("59A1-123.45", "59A1-123.45"),
    ("59AB-123.45", "59AB-123.45"),
    ("51B-12B.I5", "51B-128.15"),
])
def test_ocr_corrects_only_unambiguous_character_positions(monkeypatch, raw, expected):
    monkeypatch.setattr(config, "USE_STUB", False)
    monkeypatch.setattr(ocr, "_reader", SimpleNamespace(readtext=Mock(return_value=[
        ([[0, 0], [100, 0], [100, 20], [0, 20]], raw, 0.8),
    ])))
    assert ocr.read_plate(np.zeros((40, 160, 3), dtype=np.uint8))[0] == expected
