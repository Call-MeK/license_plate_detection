"""P4 phụ trách. Hợp đồng: read_plate(crop) -> (text, conf)."""

import cv2
import numpy as np

from src import config
from src.postprocess import clean_plate, format_plate, is_valid

_reader = None


def _load():
    global _reader
    if _reader is None:
        if not config.OCR_MODEL_DIR.is_dir():
            raise FileNotFoundError(
                "Prepare the EasyOCR cache at OCR_MODEL_DIR before offline use"
            )
        import easyocr

        _reader = easyocr.Reader(
            ["en"],
            gpu=False,
            download_enabled=False,
            model_storage_directory=str(config.OCR_MODEL_DIR),
        )
    return _reader


def _candidate(parts):
    if not parts:
        return "", 0.0
    rows = []
    for item in sorted(parts, key=lambda p: sum(point[1] for point in p[0]) / len(p[0])):
        ys = [point[1] for point in item[0]]
        center = sum(ys) / len(ys)
        height = max(1, max(ys) - min(ys))
        row = next((row for row in rows if abs(center - row[0]) <= .6 * max(height, row[1])), None)
        if row is None:
            rows.append([center, height, [item]])
        else:
            row[2].append(item)
            row[0] = (row[0] * (len(row[2]) - 1) + center) / len(row[2])
            row[1] = max(row[1], height)
    text = "".join(item[1] for row in sorted(rows, key=lambda row: row[0])
                   for item in sorted(row[2], key=lambda item: min(point[0] for point in item[0])))
    confidence = sum(part[2] for part in parts) / len(parts)
    plate = clean_plate(text)
    if len(plate) in (8, 9):
        plate = (
            plate[:2]
            + {"8": "B", "6": "G", "1": "I", "0": "O", "5": "S", "2": "Z"}.get(plate[2], plate[2])
            + plate[3:]
        )
    return plate, confidence


def _preprocess(crop):
    height, width = crop.shape[:2]
    scale = min(3.0, 64 / height, 1920 / max(height, width))
    image = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC) if scale > 1 else crop
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    if config.OCR_RETRY_VARIANT == "threshold":
        return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    if np.std(gray) < 35:
        return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return gray


def read_plate(crop):
    if config.USE_STUB:
        return "51F-123.45", 0.80
    if crop is None or crop.size == 0:
        return "", 0.0
    reader = _load()
    allowlist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-."
    best = _candidate(reader.readtext(crop, allowlist=allowlist))
    if config.OCR_RETRY_PREPROCESS and (not is_valid(best[0]) or best[1] < .6):
        retry = _candidate(reader.readtext(_preprocess(crop), allowlist=allowlist))
        if (is_valid(retry[0]), retry[1]) > (is_valid(best[0]), best[1]):
            best = retry
    return format_plate(best[0]), best[1]
