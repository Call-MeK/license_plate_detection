from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from src import config, ocr


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
