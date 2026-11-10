"""P4 phụ trách. Hợp đồng: read_plate_lines(crop) -> (lines, conf); read_plate(crop) -> (text, conf)."""
import cv2
import numpy as np

from src import config
from src.postprocess import clean_lines, format_plate, is_valid

_reader = None
# Cho phép "-" và "." để OCR không đọc dấu phân cách thành chữ/số; clean_lines bỏ chúng đi
# (docs/ocr-benchmark.md: chỉ cho chữ và số làm kết quả giảm từ 20/20 xuống 10/20).
ALLOWLIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-."
RETRY_MIN_CONF = 0.6
# Cắt bớt mép crop trước khi đọc nhanh: viền đen của biển bị đọc thành "1"/"I".
INSET_X, INSET_Y = 0.05, 0.08


def _load():
    global _reader
    if _reader is None:
        if not config.OCR_MODEL_DIR.is_dir():
            raise FileNotFoundError("Prepare the EasyOCR cache at OCR_MODEL_DIR before offline use")
        import easyocr
        # Có CRAFT để dự phòng khi đọc nhanh (recognize, không CRAFT) ra biển sai.
        _reader = easyocr.Reader(["en"], gpu=False, download_enabled=False,
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


def _read_images(reader, images):
    results = [_recognize_line(reader, image) for image in images]
    results = [(text, conf) for text, conf in results if text]
    if not results:
        return [], 0.0
    return [text for text, _ in results], sum(conf for _, conf in results) / len(results)


def _plate_is_valid(lines):
    return is_valid("".join(clean_lines(lines)))


def _read_gray(reader, gray):
    height, width = gray.shape[:2]
    if width / height >= config.ONE_LINE_MIN_RATIO:
        return _read_images(reader, [gray])
    lines, confidence = _read_images(reader, [gray[:height // 2], gray[height // 2:]])
    if _plate_is_valid(lines):
        return lines, confidence
    # Biển 1 dòng bị nghiêng có thể có tỉ lệ khung thấp và bị cắt đôi: đọc lại cả crop.
    retry = _read_images(reader, [gray])
    return retry if _plate_is_valid(retry[0]) else (lines, confidence)


def _preprocess(crop):
    """Ảnh xám phóng to (crop nhỏ) và tăng tương phản (CLAHE) hoặc adaptive threshold."""
    height, width = crop.shape[:2]
    scale = min(3.0, 64 / height, 1920 / max(height, width))
    image = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC) if scale > 1 else crop
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    if config.OCR_RETRY_VARIANT == "threshold":
        return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    if np.std(gray) < 35:
        return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return gray


def _inset(gray):
    height, width = gray.shape[:2]
    dy, dx = int(height * INSET_Y), int(width * INSET_X)
    return gray[dy:height - dy, dx:width - dx] if height - 2 * dy >= 2 and width - 2 * dx >= 2 else gray


def _rows(parts):
    """Gom các vùng chữ CRAFT thành dòng (trên → dưới), mỗi dòng ghép trái → phải."""
    rows = []
    for item in sorted(parts, key=lambda p: sum(point[1] for point in p[0]) / len(p[0])):
        ys = [point[1] for point in item[0]]
        center, height = sum(ys) / len(ys), max(1, max(ys) - min(ys))
        row = next((row for row in rows if abs(center - row[0]) <= .6 * max(height, row[1])), None)
        if row is None:
            rows.append([center, height, [item]])
        else:
            row[2].append(item)
            row[0] = (row[0] * (len(row[2]) - 1) + center) / len(row[2])
            row[1] = max(row[1], height)
    lines = ["".join(item[1] for item in sorted(row[2], key=lambda item: min(p[0] for p in item[0]))).upper()
             for row in sorted(rows, key=lambda row: row[0])]
    lines = [line for line in lines if line]
    return lines, (sum(part[2] for part in parts) / len(parts) if lines else 0.0)


def _read_craft(reader, image):
    return _rows(reader.readtext(image, allowlist=ALLOWLIST))


def _better(a, b):
    return b if (_plate_is_valid(b[0]), b[1]) > (_plate_is_valid(a[0]), a[1]) else a


def read_plate_lines(crop):
    """Return raw uppercase plate lines (1 or 2) and the mean confidence of lines with text.

    Đọc nhanh (recognize theo dòng, đã cắt mép). Nếu biển không hợp lệ hoặc điểm dưới
    RETRY_MIN_CONF thì đọc lại bằng CRAFT trên crop gốc, rồi (OCR_RETRY_PREPROCESS) trên ảnh
    tiền xử lý; giữ kết quả tốt nhất theo (hợp lệ, điểm).
    """
    if config.USE_STUB:
        return ["51F12345"], 0.80
    if crop is None or crop.size == 0 or min(crop.shape[:2]) < 2:
        return [], 0.0
    reader = _load()
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    best = _read_gray(reader, _inset(gray))
    good = lambda result: _plate_is_valid(result[0]) and result[1] >= RETRY_MIN_CONF
    if good(best):
        return best
    best = _better(best, _read_craft(reader, crop))
    if not good(best) and config.OCR_RETRY_PREPROCESS:
        best = _better(best, _read_craft(reader, _preprocess(crop)))
    return best


def read_plate(crop):
    if config.USE_STUB:
        return "51F-123.45", 0.80
    lines, confidence = read_plate_lines(crop)
    return format_plate("".join(clean_lines(lines))), confidence
