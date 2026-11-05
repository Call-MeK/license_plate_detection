# Hướng dẫn quay video và đo tốc độ nhận diện

Script `scripts/benchmark_recognition.py` chạy lại đúng pipeline nhận diện (detector + OCR + luật bầu chọn) trên một video có nhãn, rồi báo cáo thời gian đến khi biển số `STABLE` và tỉ lệ đọc đúng. Dùng cùng một video để so sánh code gốc (tag `bench-baseline`) với các bản tối ưu sau đó.

## 1. Quay video

- Đặt laptop/webcam đúng như lúc vận hành thật: cùng vị trí, góc nghiêng, độ cao, ánh sáng và khoảng cách tới làn xe.
- Quay liên tục một video (`.mp4`), cho từng xe đi vào khung hình rồi dừng ở vị trí quẹt thẻ/nhận diện như lúc thực tế.
- Quay **tối thiểu 20 xe**, gồm cả ô tô và xe máy.
- Cố gắng có đủ các trường hợp khó:
  - biển ô tô 2 dòng (biển vuông);
  - biển có seri 2 chữ cái (ví dụ `51LD`, `30KT`);
  - biển cũ 4 số (ví dụ `29B1234`).
- Giữa hai xe nên có một khoảng trống ngắn (khung hình không có xe) để dễ ghi nhãn.
- Ghi lại biển số thật của từng xe (đọc bằng mắt) ngay khi quay để không nhầm khi gắn nhãn.

## 2. File nhãn (CSV)

Mỗi xe một dòng, có dòng tiêu đề với bốn cột:

| Cột | Ý nghĩa |
| --- | --- |
| `start_s` | giây trong video khi xe bắt đầu vào khung hình (đủ rõ để nhận diện) |
| `end_s` | giây trong video khi xe rời khung hình hoặc quá thời gian chờ chấp nhận được |
| `plate` | biển số chuẩn hoá, không dấu, không khoảng trắng, ví dụ `51F12345` |
| `vehicle_type` | `CAR` hoặc `MOTORBIKE` |

Ví dụ:

```csv
start_s,end_s,plate,vehicle_type
2.0,8.0,51F12345,CAR
12.5,18.0,59A112345,MOTORBIKE
23.0,30.0,51LD12345,CAR
35.5,41.0,29B101234,MOTORBIKE
```

Biển số trong cột `plate` phải viết đúng cách lưu trong cơ sở dữ liệu (chuỗi chuẩn hoá, ví dụ `51F12345`), vì script so sánh chuỗi này với kết quả đọc được.

## 3. Chạy

Chạy trên laptop có model thật (`USE_STUB=false`, đã có `models/plate_detector.pt` và cache EasyOCR):

```bash
USE_STUB=false .venv/bin/python scripts/benchmark_recognition.py \
    --video data/demo.mp4 --labels data/demo_labels.csv
```

Tuỳ chọn:

- `--max-edge 1280`: thu nhỏ khung về cạnh dài tối đa này trước khi nhận diện (không phóng to khung nhỏ hơn).
- `--upload-ms 0`: độ trễ tải ảnh giả lập cộng thêm cho mỗi khung (ms), để mô phỏng đường truyền từ trình duyệt lên máy chủ.

Với mỗi xe, script mô phỏng cách giao diện vận hành: đồng hồ bắt đầu ở `start_s`, lấy khung hình tại thời điểm đồng hồ, nhận diện, cộng thời gian xử lý thật vào đồng hồ rồi lấy khung kế tiếp, cho đến khi biển số `STABLE` hoặc đồng hồ vượt `end_s`.

Để đo mốc gốc, chạy trên tag `bench-baseline`:

```bash
git checkout bench-baseline
# chạy lệnh benchmark ở trên, lưu kết quả
git checkout -
```

## 4. Đọc kết quả

Đầu ra gồm thông tin máy (CPU, số nhân, `USE_STUB`, đường dẫn model), bảng từng xe (biển thật, biển đọc được, loại xe thật theo nhãn, loại xe hệ thống gợi ý — dấu `?` nếu chưa chắc —, số giây đến `STABLE`, dấu `-` nếu không chốt được) và một dòng tổng kết:

| Trường | Ý nghĩa |
| --- | --- |
| `vehicles` | tổng số xe trong file nhãn |
| `stable` | số xe đạt `STABLE` trong khoảng nhãn |
| `timeouts` | số xe không đạt `STABLE` trước `end_s` |
| `median_s` | trung vị thời gian đến `STABLE` (giây), tính trên các xe đã `STABLE` |
| `max_s` | thời gian đến `STABLE` lâu nhất (giây) |
| `accuracy` | số xe đọc đúng biển / tổng số xe (xe không `STABLE` tính là sai, kể cả khi đoán gần đúng) |
| `stable_wrong` | số xe đã `STABLE` nhưng **sai biển** — lỗi nguy hiểm nhất vì nhân viên dễ xác nhận luôn; nên bằng 0 |
| `type_correct` | số xe được gợi ý đúng loại xe (khớp cột `vehicle_type` trong nhãn) |
| `type_wrong` | số xe được gợi ý sai loại xe |
| `type_unsure` | số xe hệ thống chưa chắc nên không chọn sẵn (không gợi ý) |

Loại xe được gợi ý bằng `src/vehicle_type.py` cho biển ứng viên **ngay lúc `STABLE`**, từ seri ở dòng trên của biển và tỉ lệ rộng/cao của khung biển (không dùng hồ sơ xe vì video không có hồ sơ). Vì chỉ tính khi đã `STABLE`, xe không chốt được biển (`timeouts`) luôn tính vào `type_unsure`; do đó `type_correct + type_wrong + type_unsure` bằng `vehicles`. Gợi ý chỉ được tính theo biển đã `STABLE`, kể cả khi biển đó đọc sai so với nhãn. Nên đọc `type_wrong` kỹ nhất: gợi ý sai làm nhân viên chọn nhầm loại xe, còn `type_unsure` chỉ buộc họ chọn tay.

Tiêu chí đạt của đợt tối ưu: `median_s` < 2 giây và `accuracy` không thấp hơn mốc `bench-baseline`.

Khi chạy server (`./run.sh`), mỗi khung hình tải lên cũng được ghi một dòng log dạng `frame seq=… decode_ms=… detect_ms=… ocr_ms=… total_ms=… status=… votes=…` để thấy bước nào tốn thời gian nhất.
