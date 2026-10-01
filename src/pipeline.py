"""P1 phụ trách. Ghép detector + OCR cho một frame."""
import cv2
from src.detector import detect_plates
from src.ocr import read_plate


def process_frame(frame):
    H, W = frame.shape[:2]
    results = []
    for x1, y1, x2, y2, conf in detect_plates(frame):
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        text, ocr_conf = read_plate(frame[y1:y2, x1:x2])
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame, text, (x1, max(15, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        results.append((text, ocr_conf))
    return frame, results
