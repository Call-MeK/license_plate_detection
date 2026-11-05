# Offline recognition assets

No trained detector weights or labeled evaluation set are included. The default
`USE_STUB=true` returns synthetic detections/OCR; every recognition session exposes
`stub: true`. These responses do not establish model accuracy or real CPU latency.

For real inference, export the trained `.pt` file from
`notebooks/p3_train_yolov8_kaggle.ipynb` and provision the EasyOCR English recognition
model (`english_g2.pth`) on an internet-connected preparation machine. The EasyOCR
text-detection model (`craft_mlt_25k.pth`) is no longer required: OCR runs
recognition-only on the plate crop. Copy the detector weights and the EasyOCR cache
to the demo laptop before disconnecting it. Do not commit model binaries.

Export the detector to ONNX on a machine with network access or on Kaggle (the
export step is not run on the offline laptop):

```bash
yolo export model=models/plate_detector.pt format=onnx imgsz=640
```

This writes `models/plate_detector.onnx`. When `PLATE_MODEL` is empty or unset, the
detector automatically uses `models/plate_detector.onnx` if it exists and otherwise
falls back to `models/plate_detector.pt`. Copy the `.onnx` file to the laptop with the
`.pt` file. OpenVINO export is optional for Intel laptops; it is not selected
automatically.

PowerShell configuration before starting the server (leave `PLATE_MODEL` unset to
auto-select the `.onnx` or `.pt` file; relative paths resolve from the repository root):

```powershell
$env:USE_STUB = 'false'
# $env:PLATE_MODEL = 'D:\models\plate_detector.onnx'   # optional explicit path
$env:OCR_MODEL_DIR = 'D:\models\easyocr'
```

Defaults are auto-selected `models/plate_detector.onnx` (then `.pt`) and
`models/easyocr`. Real inference requires
the detector/OCR packages in `requirements.txt`; the lighter API/test install does
not provide them. Missing detector weights fail before invoking YOLO. EasyOCR uses
CPU, recognition only (`detector=False`) and `download_enabled=False`; missing
cached assets fail instead of downloading.
The API reports `503 AI_UNAVAILABLE` and staff may use audited manual entry with a
reason. OCR confidence is a model score, not a calibrated accuracy percentage.

Before claiming readiness, run real inference with network access disabled on the
target laptop. Measure per-frame CPU latency and exact normalized plate accuracy
against a held-out, labeled camera sample, including motorbikes, cars, multiple
plates, glare, blur and oblique views. Record weights/version, dataset split,
hardware, sample count, failures and latency distribution. Those measurements and
an OCR comparison on real footage remain pending because labeled samples and
target-camera acceptance were not supplied. The current workspace now has local
weights/cache; CPU smoke measurements on a generated plate are recorded in
`docs/verification.md` and do not establish real-world accuracy or video FPS.

Recognition is intentionally one process and one worker. Collecting expires 15
seconds after creation. The first stable vote or staff confirmation moves it to
READY for 60 seconds; later frames never renew that deadline. Three agreeing votes
with mean combined detector/OCR confidence at least 0.5 and 70% of vote weight are
required for STABLE. These thresholds still need real-camera calibration. Only the
latest 20 votes and 16 candidate boxes are retained. Each live session retains
only its latest compressed frame (up to 2 MiB); staff confirmation captures a
JPEG plate crop, at most 640×256. An alert persists that crop in PostgreSQL and
serves it only to authenticated users. Manual observations have no image.
Uploads must be JPEG/PNG, at most 2 MiB and 1920 by 1080 pixels.
