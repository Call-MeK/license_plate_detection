"""Local student demo settings; train/export detector weights on Kaggle.

USE_STUB=True needs no model downloads. Real mode requires local detector
weights and the EasyOCR cache prepared before an offline demo. OCR currently
uses CPU; detector device selection is left to Ultralytics.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def resolve_plate_model(env_value: str | None, root: Path) -> Path:
    """PLATE_MODEL có giá trị thì dùng (đường dẫn tương đối tính từ root); để trống thì
    chọn models/plate_detector.onnx nếu có, không thì models/plate_detector.pt."""
    if env_value is not None and env_value.strip():
        path = Path(env_value.strip())
        return path if path.is_absolute() else root / path
    onnx = root / "models" / "plate_detector.onnx"
    return onnx if onnx.is_file() else root / "models" / "plate_detector.pt"


PLATE_MODEL = resolve_plate_model(os.getenv("PLATE_MODEL"), ROOT)
OCR_MODEL_DIR = Path(os.getenv("OCR_MODEL_DIR", str(ROOT / "models" / "easyocr")))
DET_CONF = 0.25        # ngưỡng tin cậy của detector
DET_IMGSZ = 640        # kích thước đầu vào của detector (khớp với lệnh export ONNX)
USE_STUB = os.getenv("USE_STUB", "true").strip().lower() in {"true", "1", "yes"}
ONE_LINE_MIN_RATIO = 3.0  # rộng/cao >= ngưỡng này thì biển một dòng, nhỏ hơn thì cắt đôi thành hai dòng
OCR_RETRY_PREPROCESS = os.getenv("OCR_RETRY_PREPROCESS", "true").strip().lower() in {"true", "1", "yes"}
OCR_RETRY_VARIANT = os.getenv("OCR_RETRY_VARIANT", "auto").strip().lower()
