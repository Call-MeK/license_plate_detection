# Nhận diện biển số xe (xe máy, ô tô – biển Việt Nam)

Đồ án nhóm: phát hiện và đọc biển số từ video/camera bằng YOLOv8 + OCR.
Phạm vi: xe máy và ô tô, biển Việt Nam, ban ngày, ánh sáng tốt (xem `docs/scope.md`).

## Cài đặt
```
python -m venv .venv
# Windows: .venv\Scripts\activate   |   macOS/Linux: source .venv/bin/activate
# Có GPU NVIDIA: cài torch đúng bản CUDA theo pytorch.org TRƯỚC lệnh dưới
pip install -r requirements.txt
python -c "import torch; print(torch.cuda.is_available())"
```

## Chạy
```
streamlit run app/main.py   # chạy từ thư mục gốc; đang dùng bản giả (USE_STUB=True)
python -m pytest            # test hậu xử lý
```

## Cấu trúc
- `app/` giao diện Streamlit (P1)
- `src/detector.py` detect_plates (P3) · `src/ocr.py` read_plate (P4)
- `src/postprocess.py` regex, sửa ký tự (P4) · `src/pipeline.py` ghép (P1)
- `src/config.py` cấu hình · `tests/` test · `docs/` tài liệu · `notebooks/` notebook (Kaggle)
- `data/`, `models/` không commit file nặng, chỉ ghi link tải trong README của thư mục

## Quy ước
- Nhánh: `main` ổn định; mỗi người một nhánh (`p1-app`, `p2-data`, `p3-detect`, `p4-ocr`), merge qua Pull Request.
- Hợp đồng hàm, không đổi nếu chưa bàn cả nhóm:
  - `detect_plates(frame) -> [(x1, y1, x2, y2, conf)]`
  - `read_plate(crop) -> (text, conf)`
- Có model thật: đặt `models/plate_detector.pt`, đổi `USE_STUB = False` trong `src/config.py`.
