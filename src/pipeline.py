"""P1 phụ trách. Ghép detector + OCR cho một frame."""
import cv2

from src.brightness import adjust_brightness
from src.detector import detect_plates
from src.ocr import read_plate
from src.postprocess import clean_plate, format_plate, is_valid


def process_frame(frame):
    """Return an annotated BGR copy and the largest detected plate observation."""
    height, width = frame.shape[:2]
    annotated_frame = frame.copy()
    frame = adjust_brightness(frame, 30)
    boxes = []
    for x1, y1, x2, y2, detector_confidence in detect_plates(frame):
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(width, x2), min(height, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        boxes.append((x1, y1, x2, y2, detector_confidence))
    observations = []
    if boxes:
        x1, y1, x2, y2, detector_confidence = max(
            boxes, key=lambda box: ((box[2] - box[0]) * (box[3] - box[1]), box[4])
        )
        text, ocr_confidence = read_plate(frame[y1:y2, x1:x2])
        plate = clean_plate(text)
        display_plate = format_plate(plate)
        cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(annotated_frame, display_plate, (x1, max(15, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        observations.append({
            "plate": plate,
            "display_plate": display_plate,
            "ocr_confidence": ocr_confidence,
            "detector_confidence": detector_confidence,
            "bbox": (x1, y1, x2, y2),
            "valid": is_valid(plate),
        })
    return annotated_frame, observations
