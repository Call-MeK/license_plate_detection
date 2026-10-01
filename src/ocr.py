"""P4 phụ trách. Hợp đồng: read_plate(crop) -> (text, conf)."""
from src import config
from src.postprocess import clean_plate, format_plate

_reader = None


def read_plate(crop):
    if config.USE_STUB:
        return "51F-123.45", 0.80
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["en"], gpu=False)
    parts = _reader.readtext(crop)                 # [(bbox, text, conf), ...]
    if not parts:
        return "", 0.0
    h, w = crop.shape[:2]
    two_lines = w / h < 2.5                        # biển gần vuông -> 2 dòng (v0, P4 cải tiến)

    def key(p):
        yc = (p[0][0][1] + p[0][2][1]) / 2
        return (int(yc > h / 2) if two_lines else 0, p[0][0][0])

    parts.sort(key=key)
    text = "".join(p[1] for p in parts)
    conf = sum(p[2] for p in parts) / len(parts)
    return format_plate(clean_plate(text)), conf
