"""Luật bầu chọn biển số qua nhiều khung hình liên tiếp."""
from collections import Counter
from typing import Iterable, Literal

EARLY_STOP_CONF = 0.8


def decide(votes: Iterable[tuple[str, float]]) -> tuple[str | None, Literal["STABLE", "UNCERTAIN"]]:
    """Chọn biển có tổng weight lớn nhất; plate rỗng là lần đọc không hợp lệ."""
    weights = Counter()
    counts = Counter()
    lowest = {}
    for plate, confidence in votes:
        if plate:
            weights[plate] += confidence
            counts[plate] += 1
            lowest[plate] = min(lowest.get(plate, confidence), confidence)
    if not weights:
        return None, "UNCERTAIN"
    plate = weights.most_common(1)[0][0]
    dominant = weights[plate] >= .7 * sum(weights.values())
    if counts[plate] >= 2 and lowest[plate] >= EARLY_STOP_CONF and dominant:
        return plate, "STABLE"
    # shortcut: fixed vote thresholds need calibration against labeled camera footage.
    if counts[plate] >= 3 and weights[plate] / counts[plate] >= .5 and dominant:
        return plate, "STABLE"
    return plate, "UNCERTAIN"
