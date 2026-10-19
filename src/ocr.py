"""P4 phụ trách. Hợp đồng: read_plate(crop) -> (text, conf)."""
from src import config
from src.postprocess import clean_plate, format_plate

_reader = None


def _load():
    global _reader
    if _reader is None:
        if not config.OCR_MODEL_DIR.is_dir():
            raise FileNotFoundError("Prepare the EasyOCR cache at OCR_MODEL_DIR before offline use")
        import easyocr
        _reader = easyocr.Reader(["en"], gpu=False, download_enabled=False,
                                 model_storage_directory=str(config.OCR_MODEL_DIR))
    return _reader


def read_plate(crop):
    if config.USE_STUB:
        return "51F-123.45", 0.80
    parts = _load().readtext(crop)
    if not parts:
        return "", 0.0
    height, width = crop.shape[:2]
    # shortcut: suy ra số dòng từ tỷ lệ ảnh, đổi sang gom dòng khi đánh giá biển nghiêng.
    two_lines = width / height < 2.5

    def reading_order(part):
        box = part[0]
        center_y = (box[0][1] + box[2][1]) / 2
        row = int(center_y > height / 2) if two_lines else 0
        return row, box[0][0]

    parts.sort(key=reading_order)
    text = "".join(part[1] for part in parts)
    confidence = sum(part[2] for part in parts) / len(parts)
    return format_plate(clean_plate(text)), confidence
