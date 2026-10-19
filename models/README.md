# Offline recognition assets

No trained detector weights or labeled evaluation set are included. The default
`USE_STUB=true` returns synthetic detections/OCR; every recognition session exposes
`stub: true`. These responses do not establish model accuracy or real CPU latency.

For real inference, export the trained `.pt` file from
`notebooks/p3_train_yolov8_kaggle.ipynb` and provision the EasyOCR English detection
and recognition cache on an internet-connected preparation machine. Copy both
assets to the demo laptop before disconnecting it. Do not commit model binaries.

PowerShell configuration before starting the server:

```powershell
$env:USE_STUB = 'false'
$env:PLATE_MODEL = 'D:\models\plate_detector.pt'
$env:OCR_MODEL_DIR = 'D:\models\easyocr'
```

Defaults are `models/plate_detector.pt` and `models/easyocr`. Real inference requires
the detector/OCR packages in `requirements.txt`; the lighter API/test install does
not provide them. Missing detector weights fail before invoking YOLO. EasyOCR uses
CPU and `download_enabled=False`; missing cached assets fail instead of downloading.
The API reports `503 AI_UNAVAILABLE` and staff may use audited manual entry with a
reason. OCR confidence is a model score, not a calibrated accuracy percentage.

Before claiming readiness, run real inference with network access disabled on the
target laptop. Measure per-frame CPU latency and exact normalized plate accuracy
against a held-out, labeled camera sample, including motorbikes, cars, multiple
plates, glare, blur and oblique views. Record weights/version, dataset split,
hardware, sample count, failures and latency distribution. Those measurements and
an OCR comparison remain pending because the weights, sample labels and target
camera/laptop were not supplied.

Recognition is intentionally one process and one worker. Collecting expires 15
seconds after creation. The first stable vote or staff confirmation moves it to
READY for 60 seconds; later frames never renew that deadline. Three agreeing votes
with mean combined detector/OCR confidence at least 0.5 and 70% of vote weight are
required for STABLE. These thresholds still need real-camera calibration. Only the
latest 20 votes and 16 candidate boxes are retained; frames are discarded after
inference. Uploads must be JPEG/PNG, at most 2 MiB and 1920 by 1080 pixels.
