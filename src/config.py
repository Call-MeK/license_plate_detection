from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLATE_MODEL = ROOT / "models" / "plate_detector.pt"
DET_CONF = 0.25        # ngưỡng tin cậy của detector
USE_STUB = True        # False khi đã có model thật và OCR thật
