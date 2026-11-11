# Bãi xe nhận diện biển số — MVP v2

FastAPI + PostgreSQL và React/TypeScript/Vite/Tailwind: webcam/video → nhân viên
xác nhận biển số → kiểm tra watchlist → check-in/out, tính phí, xác nhận thu tiền,
lịch sử và quản trị. Giữ nguyên pipeline AI và demo Streamlit bên dưới.

## Chạy ứng dụng v2 trên Windows

Cài Python, Node.js và PostgreSQL; chuẩn bị dependency/model trước khi ngắt mạng:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -r requirements-dev.txt
cd frontend
npm.cmd ci
npm.cmd run build
cd ..
Copy-Item .env.example .env
```

Nếu chưa cần AI thật, có thể cài bộ backend/test nhẹ:

```powershell
python -m pip install fastapi uvicorn sqlalchemy "psycopg[binary]" PyJWT argon2-cffi python-dotenv python-multipart httpx pytest numpy opencv-python pillow streamlit
```

Tạo role/database riêng trong PostgreSQL (mở `psql -h 127.0.0.1 -U postgres`):

```sql
CREATE ROLE parking LOGIN;
\password parking
CREATE DATABASE parking OWNER parking;
CREATE DATABASE parking_test OWNER parking;
\q
```

Điền `DATABASE_URL` đúng cổng/mật khẩu trong `.env`; ký tự đặc biệt của mật khẩu
trong URL cần percent-encoding. Sinh `JWT_SECRET` một lần và lưu vào `.env`:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Điền `ADMIN_USERNAME`, `ADMIN_PASSWORD` ít nhất 12 ký tự trong `.env`, rồi chạy:

```powershell
python -m app.database init
python -m app.database seed-admin
python -m app.database seed-demo
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Mở **http://127.0.0.1:8000**, đăng nhập Admin và tạo Staff trong Quản trị. Xóa
`ADMIN_PASSWORD` khỏi `.env` sau bootstrap. `init` tạo schema ban đầu 9 bảng,
không xóa dữ liệu và chưa hỗ trợ nâng cấp schema đang vận hành. `seed-demo` thêm
giá ô tô 5.000đ/giờ, xe máy 3.000đ/giờ (bước 30 phút), watchlist **hư cấu**
`51F12346`; giữ giá/hồ sơ đã có. Không có tài khoản/mật khẩu mặc định.

Backend phục vụ frontend đã build; khởi động lại backend sau lần build đầu.
Khi phát triển, chạy `npm.cmd run dev` trong `frontend/`; Vite proxy `/api` về
backend. RecognitionSession lưu RAM nên **chỉ chạy một worker**.

`USE_STUB=true` là dữ liệu giả có nhãn trên UI. Muốn AI thật, đặt `USE_STUB=false`
và chuẩn bị weights/cache theo [models/README.md](models/README.md); không tự tải
model khi chạy. Không dùng test stub để báo cáo accuracy/FPS.

OCR đọc nhanh trước: bỏ bước dò vùng chữ (CRAFT), cắt mép crop 5% ngang và 8% dọc
để viền biển không bị đọc thành `1`, rồi đọc từng dòng (biển vuông cắt đôi thành
2 dòng). Nếu biển không hợp lệ hoặc confidence dưới 0,6 thì đọc lại bằng CRAFT
trên crop gốc, sau đó thử thêm một ảnh xám (phóng to crop nhỏ và dùng CLAHE khi
tương phản thấp); giữ kết quả tốt nhất. Để so sánh, đặt
`OCR_RETRY_PREPROCESS=false` để tắt lần thử ảnh xám; đặt
`OCR_RETRY_VARIANT=threshold` để thử adaptive threshold thay cho ảnh xám/CLAHE.
Thay đổi `.env` cần khởi động lại backend. Điểm confidence không phải accuracy;
ảnh đầu vào không được lưu ra đĩa bởi bước tiền xử lý.

Tạo `.env.test` chứa `TEST_DATABASE_URL=postgresql+psycopg://.../parking_test`
trỏ vào DB kiểm thử riêng, user có quyền tạo/xóa schema. Test tích hợp dùng
PostgreSQL thật và schema riêng mỗi test; thiếu DB sẽ skip, không chứng nhận
transaction. Kiểm tra:

```powershell
python -m pytest -q
cd frontend
npm.cmd test -- --run
npm.cmd run build
```

[Kịch bản demo, khôi phục và giới hạn](docs/demo-runbook.md) ·
[Hợp đồng API v1](docs/api-contract.md) ·
[Tiến độ và bằng chứng kiểm thử](docs/implementation-progress.md).
System Design Spec v1 được kế hoạch tham chiếu chưa có trong repo; DTO cần đối
chiếu khi có tài liệu gốc. `.env`, `.env.test`, `.local/`, model/video và cache
build không commit; fixture `data/demo.json` không chứa dữ liệu cá nhân.

## Ghi chú nâng cấp: biển seri đặc biệt `LD`

Từ nhánh tăng tốc nhận diện, biển 4 số cũ có seri 2 chữ đặc biệt của ô tô
(`LD`, `KT`, `HC`, `NN`, `NG`, `QT`, `CV`) được lưu đúng chữ, ví dụ `51LD1234`.
Bản trước đổi chữ `D` thứ 5 từ cuối thành số nên biển `51LD-1234` từng được lưu
thành `51L01234`; các seri đặc biệt khác trước đây bị coi là không hợp lệ nên
không có trong DB. Sau khi nâng cấp, cùng chiếc xe đó sẽ khớp khóa `51LD1234`,
không khớp hồ sơ hay watchlist cũ. Admin nên tìm các dòng nghi ngờ:

```sql
SELECT id, plate_number, vehicle_type, created_at FROM vehicles
 WHERE plate_number ~ '^\d{2}L0\d{4}$';
SELECT id, plate_number, status, description FROM stolen_vehicles
 WHERE plate_number ~ '^\d{2}L0\d{4}$';
-- lịch sử, chỉ để tra cứu:
SELECT id, plate_number, check_in_at FROM parking_sessions
 WHERE plate_number ~ '^\d{2}L0\d{4}$';
```

Biển 5 số thật như `51L-012.34` cũng khớp mẫu trên, nên đối chiếu từng dòng với
biển thật trước khi sửa, ví dụ
`UPDATE stolen_vehicles SET plate_number = '51LD1234' WHERE id = '...';`
(cột `plate_number` là duy nhất; nếu đã có dòng `51LD1234` thì gộp tay).

## Demo AI Streamlit hiện hữu

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
- Có model thật: đặt `models/plate_detector.pt` (và nên xuất thêm
  `models/plate_detector.onnx` để suy luận CPU nhanh hơn, xem
  [models/README.md](models/README.md)), đặt `USE_STUB=false` trong `.env`.

## D1: phạm vi demo và runtime

- Demo sinh viên chạy cục bộ trên máy Windows này, nhận video tải lên qua Streamlit.
  Huấn luyện detector trên notebook Kaggle; tải trọng số về máy để suy luận.
  Không triển khai dịch vụ công khai; lệnh trên chỉ lắng nghe tại `127.0.0.1`.
- Phần cứng đã kiểm tra: Intel Core i5-13420H, RAM khoảng 16 GB,
  NVIDIA GeForce RTX 2050 và Intel UHD Graphics. Chưa đo tốc độ suy luận thật.
- `src/config.py`: `USE_STUB=True` mặc định, `DET_CONF=0.25`. `PLATE_MODEL`
  để trống hoặc không đặt (`PLATE_MODEL=`) là tự chọn: dùng
  `models/plate_detector.onnx` nếu có, không thì `models/plate_detector.pt`;
  đặt giá trị thì dùng đúng file đó (đường dẫn tương đối tính từ gốc dự án).
  Xuất ONNX trên máy có mạng hoặc Kaggle:
  `yolo export model=models/plate_detector.pt format=onnx imgsz=640`.
  **Lưu ý:** file `.onnx` cũ vẫn được ưu tiên hơn file `.pt` mới hơn; sau khi
  train lại phải xuất lại `.onnx` hoặc xóa nó.
  Stub trả dữ liệu giả để kiểm tra tích hợp, không dùng đánh giá độ chính xác.
- OCR thật hiện dùng CPU (`gpu=False`); detector dùng lựa chọn thiết bị mặc định
  của Ultralytics. Có GPU không đồng nghĩa đã cài PyTorch/CUDA tương thích.
  Chuẩn bị trọng số detector và cache EasyOCR trước khi demo không có Internet;
  thiếu cache sẽ báo lỗi; EasyOCR được cấu hình không tải model khi chạy.
- Cài các gói test: `python -m pip install pytest numpy opencv-python`.
  Demo stub cần thêm `streamlit`; chạy model thật cần các dependency trong
  `requirements.txt` và trọng số đã huấn luyện.

## Hợp đồng pipeline

Đầu vào là ảnh NumPy `uint8` BGR, kích thước `(H, W, 3)`, không rỗng.
Detector trả tọa độ pixel nguyên `(x1, y1, x2, y2)` và confidence trong `[0, 1]`;
OCR trả `(text, confidence)` với confidence trong `[0, 1]`. Hai hàm này chỉ đọc
ảnh đầu vào. Chữ ký của detector và OCR giữ nguyên.

Pipeline tạo bản sao để vẽ, giữ nguyên ảnh gốc và màu BGR. Detector và OCR nhận
ảnh đã tăng sáng. Box được cắt theo biên ảnh; box rỗng sau khi cắt bị bỏ qua.
Chỉ box có diện tích lớn nhất được đưa vào OCR; nếu bằng nhau, chọn confidence
detector cao hơn. Không có detection thì trả bản sao ảnh và `[]`.
Lỗi detector/OCR được truyền cho caller, không chuyển thành kết quả rỗng.

Box được chọn trả một dictionary, kể cả OCR rỗng hoặc sai định dạng:

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

Streamlit hiển thị ảnh đã vẽ và bảng observation của frame hiện tại. Pipeline
`src/` xử lý theo frame; API v2 bổ sung weighted voting và xác nhận của nhân viên.
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
