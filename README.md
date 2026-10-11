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
python -m streamlit run app/main.py --server.address 127.0.0.1 --browser.gatherUsageStats false
python -m pytest tests/test_pipeline.py -q
python -m pytest -q
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
  - `process_frame(frame) -> (annotated_frame, observations)` (chi tiết bên dưới)
- Có model thật: đặt `models/plate_detector.pt`, đổi `USE_STUB = False` trong `src/config.py`.

## D1: phạm vi demo và runtime

- Demo sinh viên chạy cục bộ trên máy Windows này, nhận video tải lên qua Streamlit.
  Huấn luyện detector trên notebook Kaggle; tải trọng số về máy để suy luận.
  Không triển khai dịch vụ công khai; lệnh trên chỉ lắng nghe tại `127.0.0.1`.
- Phần cứng đã kiểm tra: Intel Core i5-13420H, RAM khoảng 16 GB,
  NVIDIA GeForce RTX 2050 và Intel UHD Graphics. Chưa đo tốc độ suy luận thật.
- `src/config.py`: `USE_STUB=True` mặc định, `DET_CONF=0.25`,
  `PLATE_MODEL=models/plate_detector.pt` (đường dẫn tính từ gốc dự án).
  Stub trả dữ liệu giả để kiểm tra tích hợp, không dùng đánh giá độ chính xác.
- OCR thật hiện dùng CPU (`gpu=False`); detector dùng lựa chọn thiết bị mặc định
  của Ultralytics. Có GPU không đồng nghĩa đã cài PyTorch/CUDA tương thích.
  Chuẩn bị trọng số detector và cache EasyOCR trước khi demo không có Internet;
  lần khởi tạo EasyOCR có thể tải model nếu cache chưa có.
- Cài các gói test: `python -m pip install pytest numpy opencv-python`.
  Demo stub cần thêm `streamlit`; chạy model thật cần các dependency trong
  `requirements.txt` và trọng số đã huấn luyện.

## Hợp đồng pipeline

Đầu vào là ảnh NumPy `uint8` BGR, kích thước `(H, W, 3)`, không rỗng.
Detector trả tọa độ pixel nguyên `(x1, y1, x2, y2)` và confidence trong `[0, 1]`;
OCR trả `(text, confidence)` với confidence trong `[0, 1]`. Hai hàm này chỉ đọc
ảnh đầu vào. Chữ ký của detector và OCR giữ nguyên.

Pipeline tạo bản sao để vẽ, giữ nguyên ảnh gốc và màu BGR. OCR nhận crop từ ảnh
gốc, kể cả khi các box chồng nhau. Box được cắt theo biên ảnh; box rỗng sau khi
cắt bị bỏ qua, không gọi OCR. Không có detection thì trả bản sao ảnh và `[]`.
Lỗi detector/OCR được truyền cho caller, không chuyển thành kết quả rỗng.

Mỗi box còn diện tích trả một dictionary, theo thứ tự detector, kể cả OCR rỗng
hoặc sai định dạng:

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| `plate` | `str` | Chuỗi chuẩn hóa bởi `clean_plate`, ví dụ `51F12345` |
| `display_plate` | `str` | Chuỗi từ `format_plate`, ví dụ `51F-123.45`; dùng để vẽ |
| `ocr_confidence` | `float` | Confidence OCR, giữ nguyên, không phải phần trăm |
| `detector_confidence` | `float` | Confidence detector, giữ nguyên |
| `bbox` | `tuple[int, int, int, int]` | Box đã cắt `(x1, y1, x2, y2)`, cận phải/dưới không thuộc crop |
| `valid` | `bool` | Kết quả `is_valid(plate)`; chỉ kiểm tra mẫu ký tự hiện có |

Ví dụ observation:

```python
{
    "plate": "51F12345",
    "display_plate": "51F-123.45",
    "ocr_confidence": 0.82,
    "detector_confidence": 0.91,
    "bbox": (10, 25, 90, 60),
    "valid": True,
}
```

UI hiển thị ảnh đã vẽ và bảng observation của frame hiện tại. Đây là detection
theo frame; chưa có tracking hoặc gộp biển trùng giữa các frame.
`app/main.py` tách phần nhận video (`main`) và xử lý/hiển thị (`display_video`).
Video được giải phóng và file tạm được dọn khi kết thúc, kể cả khi pipeline/UI lỗi.

## Fixtures và tiêu chí đánh giá D1

`tests/test_pipeline.py` tạo ảnh BGR 80 × 120 trong bộ nhớ, mock detector/OCR;
không cần ảnh cá nhân, model, GPU hoặc Internet. Fixtures gồm biển ô tô
`51F-123.45`, xe máy `59A1-123.45`, ký tự OCR nhầm, OCR rỗng/sai, không có
detection, box vượt biên/rỗng/đảo chiều và các box chồng nhau.

Tiêu chí tích hợp: test pipeline và toàn bộ suite đều đạt; đủ sáu trường đúng
giá trị; input không đổi; annotation có bộ nhớ riêng; crop đúng vùng; box rỗng
không gọi OCR; UI đọc các dictionary mới. Test mock không chứng minh chất lượng model.

Mục tiêu đánh giá model theo `docs/scope.md`: mAP@0.5 ≥ 0.90, OCR khớp nguyên
biển ≥ 80–85% trong điều kiện tốt, video ≥ 15 FPS trên máy demo. Đo trên tập
test tách khỏi dữ liệu huấn luyện; so sánh chuỗi biển chuẩn hóa, ghi rõ số mẫu,
độ phân giải, thiết bị và thời gian sau khi tải model. Các mốc này là mục tiêu,
chưa phải kết quả. Nguồn dữ liệu đã chọn là
[Vietnam License Plate Segment Datasets trên Kaggle](https://www.kaggle.com/datasets/duydieunguyen/licenseplates).
Chưa tải/kiểm tra các file: cần xác nhận phiên bản, giấy phép, loại nhãn (box hay
polygon), ánh xạ về một lớp `license_plate` và nhãn chuỗi OCR trước khi dùng.
Không dùng tập validation làm test cuối; giữ các ảnh cùng xe/video trong cùng
một split để tránh rò rỉ dữ liệu. Clip demo cụ thể và nhãn ground truth vẫn
cần chốt trước khi đánh giá thật.

Nguồn bổ sung đã tra cứu (chưa tải hoặc trộn vào tập đang chọn):

| Nguồn | Nội dung nhà cung cấp mô tả | Cách dùng đề xuất |
| --- | --- | --- |
| [VNLP](https://github.com/fict-labs/VNLP) | Khoảng 37.300 ảnh, nhãn vị trí và ký tự biển, có biển một/hai dòng | Bổ sung kiểm tra OCR và bố cục; lọc mẫu phù hợp phạm vi biển 5 số cuối hiện tại |
| [Vietnamese Plate Dataset của winter2897](https://github.com/winter2897/Real-time-Auto-License-Plate-Recognition-with-Jetson-Nano/blob/main/doc/dataset.md) | Bộ detection, bộ ký tự ở dạng VOC/YOLO và link video đường phố Việt Nam | Ứng viên bổ sung detection và clip demo; kiểm tra nhãn chuỗi trước khi đánh giá OCR |

Ưu tiên kiểm tra tập Kaggle đang chọn trước; VNLP hữu ích nếu thiếu nhãn OCR.
Xác nhận quyền sử dụng và loại ảnh trùng trước khi bổ sung dữ liệu.
