"""Gợi ý loại xe (CAR / MOTORBIKE) từ hồ sơ, seri biển số và hình dạng biển."""
import re

from src.config import ONE_LINE_MIN_RATIO

MOTO_MAX_RATIO = 1.7  # rộng/cao nhỏ hơn mức này thì biển gần vuông -> xe máy
CAR_SPECIAL_SERIES = frozenset({"LD", "KT", "HC", "NN", "NG", "QT", "CV"})

CAR = "CAR"
MOTORBIKE = "MOTORBIKE"

_TOP_LINE = re.compile(r"^\d{2}(?P<series>[A-Z]{2}|[A-Z][1-9]|[A-Z])$")
_MOTO_NEW = re.compile(r"^\d{2}[A-Z][1-9]\d{5}$")
_CAR_OLD = re.compile(r"^\d{2}[A-Z]\d{4}$")
_AMBIGUOUS = re.compile(r"^\d{2}[A-Z]\d{5}$")
_TWO_LETTER = re.compile(r"^\d{2}(?P<series>[A-Z]{2})\d{4,5}$")


def _hint(vehicle_type, source):
    return {"type": vehicle_type, "source": source}


def _shape(bbox_ratio):
    if bbox_ratio is None:
        return None
    return MOTORBIKE if bbox_ratio < MOTO_MAX_RATIO else CAR


def _two_letter_series(series, bbox_ratio):
    lean = CAR if series in CAR_SPECIAL_SERIES else MOTORBIKE
    if _shape(bbox_ratio) == lean:
        return _hint(lean, "SERIES_SHAPE")
    return _hint(None, None)


def _from_top_line(top_line, bbox_ratio):
    """Trả gợi ý theo dòng trên, hoặc None nếu dòng trên không hợp lệ."""
    match = _TOP_LINE.match(top_line or "")
    if not match:
        return None
    series = match.group("series")
    if len(series) == 1:
        return _hint(CAR, "SERIES")
    if series[1].isdigit():
        return _hint(MOTORBIKE, "SERIES")
    return _two_letter_series(series, bbox_ratio)


def _from_plate(plate, bbox_ratio):
    if _MOTO_NEW.match(plate):
        return _hint(MOTORBIKE, "SERIES")
    if _CAR_OLD.match(plate):
        return _hint(CAR, "SERIES")
    if _AMBIGUOUS.match(plate):
        shape = _shape(bbox_ratio)
        return _hint(shape, "SERIES_SHAPE") if shape else _hint(None, None)
    match = _TWO_LETTER.match(plate)
    if match:
        return _two_letter_series(match.group("series"), bbox_ratio)
    return _hint(None, None)


def suggest_vehicle_type(plate: str, *, top_line: str | None = None,
                         bbox_ratio: float | None = None,
                         record_type: str | None = None) -> dict:
    """Thứ tự: hồ sơ -> biển 1 dòng -> seri dòng trên -> chuỗi biển. Seri luôn thắng hình dạng."""
    if record_type:
        return _hint(record_type, "RECORD")
    if bbox_ratio is not None and bbox_ratio >= ONE_LINE_MIN_RATIO:
        return _hint(CAR, "SERIES")
    from_line = _from_top_line(top_line, bbox_ratio)
    if from_line is not None:
        return from_line
    return _from_plate(plate or "", bbox_ratio)
