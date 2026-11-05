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
PLATE_MODEL = Path(os.getenv("PLATE_MODEL", str(ROOT / "models" / "plate_detector.pt")))
OCR_MODEL_DIR = Path(os.getenv("OCR_MODEL_DIR", str(ROOT / "models" / "easyocr")))
DET_CONF = 0.25        # ngưỡng tin cậy của detector
USE_STUB = os.getenv("USE_STUB", "true").strip().lower() in {"true", "1", "yes"}
OCR_RETRY_PREPROCESS = os.getenv("OCR_RETRY_PREPROCESS", "true").strip().lower() in {"true", "1", "yes"}
OCR_RETRY_VARIANT = os.getenv("OCR_RETRY_VARIANT", "auto").strip().lower()
