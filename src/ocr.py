"""P4 phụ trách. Hợp đồng: read_plate_lines(crop) -> (lines, conf); read_plate(crop) -> (text, conf)."""
import cv2

from src import config
from src.postprocess import clean_lines, format_plate

_reader = None
ALLOWLIST = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _load():
    global _reader
    if _reader is None:
        if not config.OCR_MODEL_DIR.is_dir():
            raise FileNotFoundError("Prepare the EasyOCR cache at OCR_MODEL_DIR before offline use")
        import easyocr
        # detector=False: crop đã chỉ chứa biển số, không cần CRAFT.
        _reader = easyocr.Reader(["en"], gpu=False, download_enabled=False, detector=False,
                                 model_storage_directory=str(config.OCR_MODEL_DIR))
    return _reader


def _recognize_line(reader, gray):
    """Return (text, confidence) for one image treated as a single text line."""
    parts = reader.recognize(gray, detail=1, allowlist=ALLOWLIST)
    if not parts:
        return "", 0.0
    parts = sorted(parts, key=lambda part: part[0][0][0])
    text = "".join(part[1] for part in parts).upper()
    return text, sum(part[2] for part in parts) / len(parts)


def read_plate_lines(crop):
    """Return raw uppercase plate lines (1 or 2) and the mean confidence of lines with text."""
    if config.USE_STUB:
        return ["51F12345"], 0.80
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    if width / height >= config.ONE_LINE_MIN_RATIO:
        images = [gray]
    else:
        images = [gray[:height // 2], gray[height // 2:]]
    reader = _load()
    results = [_recognize_line(reader, image) for image in images]
    results = [(text, conf) for text, conf in results if text]
    if not results:
        return [], 0.0
    return [text for text, _ in results], sum(conf for _, conf in results) / len(results)


def read_plate(crop):
    if config.USE_STUB:
        return "51F-123.45", 0.80
    lines, confidence = read_plate_lines(crop)
    return format_plate("".join(clean_lines(lines))), confidence
