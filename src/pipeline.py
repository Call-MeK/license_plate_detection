"""P1 phụ trách. Ghép detector + OCR cho một frame."""
import time

import cv2

from src.detector import detect_plates
from src.ocr import read_plate_lines
from src.postprocess import clean_lines, format_plate, is_valid


def process_frame(frame, timings=None):
    """Return an annotated BGR copy and one observation per nonempty plate box.

    When `timings` is a dict it receives `detect_ms` and `ocr_ms` (summed over plates).
    """
    height, width = frame.shape[:2]
    annotated_frame = frame.copy()
    observations = []
    ocr_seconds = 0.0
    detect_started = time.perf_counter()
    detections = detect_plates(frame)
    if timings is not None:
        timings["detect_ms"] = (time.perf_counter() - detect_started) * 1000
    for x1, y1, x2, y2, detector_confidence in detections:
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        ocr_started = time.perf_counter()
        raw_lines, ocr_confidence = read_plate_lines(frame[y1:y2, x1:x2])
        ocr_seconds += time.perf_counter() - ocr_started
        lines = clean_lines(raw_lines)
        plate = "".join(lines)
        display_plate = format_plate(plate)
        cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(annotated_frame, display_plate, (x1, max(15, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        observations.append({
            "lines": lines,
            "plate": plate,
            "display_plate": display_plate,
            "ocr_confidence": ocr_confidence,
            "detector_confidence": detector_confidence,
            "bbox": (x1, y1, x2, y2),
            "valid": is_valid(plate),
        })
    if timings is not None:
        timings["ocr_ms"] = ocr_seconds * 1000
    return annotated_frame, observations
