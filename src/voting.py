"""Luật bầu chọn biển số qua nhiều khung hình liên tiếp."""
from collections import Counter
from typing import Iterable, Literal


def decide(votes: Iterable[tuple[str, float]]) -> tuple[str | None, Literal["STABLE", "UNCERTAIN"]]:
    """Chọn biển có tổng weight lớn nhất; plate rỗng là lần đọc không hợp lệ."""
    weights = Counter()
    counts = Counter()
    for plate, confidence in votes:
        if plate:
            weights[plate] += confidence
            counts[plate] += 1
    if not weights:
        return None, "UNCERTAIN"
    plate = weights.most_common(1)[0][0]
    # shortcut: fixed vote thresholds need calibration against labeled camera footage.
    if counts[plate] >= 3 and weights[plate] / counts[plate] >= .5 and weights[plate] >= .7 * sum(weights.values()):
        return plate, "STABLE"
    return plate, "UNCERTAIN"
