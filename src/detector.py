"""P3 phụ trách. Hợp đồng: detect_plates(frame) -> [(x1, y1, x2, y2, conf)] (int, pixel của frame)."""
from src import config

_model = None


def _load():
    global _model
    if _model is None:
        if not config.PLATE_MODEL.is_file():
            raise FileNotFoundError("Prepare local detector weights at PLATE_MODEL before offline use")
        from ultralytics import YOLO
        _model = YOLO(str(config.PLATE_MODEL))
    return _model


def detect_plates(frame):
    if config.USE_STUB:  # bản giả: một khung ở giữa ảnh
        h, w = frame.shape[:2]
        return [(int(w * 0.4), int(h * 0.5), int(w * 0.6), int(h * 0.58), 0.90)]
    res = _load().predict(frame, conf=config.DET_CONF, verbose=False)[0]
    return [(int(x1), int(y1), int(x2), int(y2), float(c))
            for (x1, y1, x2, y2), c in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist())]
