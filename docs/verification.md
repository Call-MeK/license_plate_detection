# Bằng chứng kiểm tra v2 — 2026-10-20

Backend: 100 test đạt trên PostgreSQL 18, gồm concurrency, replay, nguồn giả/hết
hạn, đổi bbox, cảnh báo tồn tại sau hủy, phí qua ngày, snapshot giá và rollback.
Frontend: 17 test đạt; TypeScript và Vite build đạt. Các test AI mô phỏng được
tách biệt với smoke model thật bên dưới.

Live HTTP đã kiểm tra frontend/assets, health, CSRF, từ chối anonymous,
Admin login/logout và recognition → xác nhận → hủy. Backup/restore đã chạy vào
DB mới, kiểm tra đủ 9 bảng và fixture; DB nguồn không bị xóa.

## Smoke model thật bằng ảnh tổng hợp

- Python 3.14, torch `2.14.1+cpu`, torchvision `0.29.1+cpu`, Ultralytics
  `8.4.183`, EasyOCR `1.7.2`; suy luận CPU.
- Detector SHA-256:
  `3c79497557b9aa3f398dd4ab8ed2f938c03041d5b0759c9b5faf7193e952ee30`.
- Cache có `craft_mlt_25k.pth` và `english_g2.pth`. Không commit model binaries.
  OCR đọc nhanh không qua CRAFT, nhưng vẫn dùng CRAFT làm dự phòng nên cần cả hai file.
- Mẫu tự vẽ 640×360 có chữ `51F-123.45`; không phải ảnh xe Việt Nam thật.
- Chặn `socket.connect` và `connect_ex` trong process smoke; model load từ ổ đĩa.
  Đây không thay thế diễn tập tắt mạng toàn máy với camera/người vận hành.
- OCR crop trả `51F-123.45`, confidence 0,6492. Pipeline detector+OCR trả
  `51F12345`, valid=true; score không phải phần trăm accuracy.

| Phép đo | Lần 1 thành công | Lần lặp process mới |
| --- | ---: | ---: |
| Import/load detector + predict đầu | 3.363,3 ms | 3.439,4 ms |
| Khởi tạo OCR | 5.080,2 ms | 2.501,3 ms |
| OCR crop đã biết | 380,0 ms | 491,1 ms |
| Pipeline 5 frame sau khởi tạo | 579,0; 509,3; 533,0; 534,1; 528,9 ms | 704,9; 602,9; 495,7; 604,0; 609,4 ms |

Giá trị là thời gian thực đo trên đúng một ảnh tổng hợp lặp lại; không suy ra
FPS camera, phân bố latency trên video hoặc accuracy. Lần khởi tạo đầu tiên sau
cài dependency từng gặp ImportError nội bộ PyTorch `NP_SUPPORTED_MODULES`;
hai process smoke mới và API thật sau đó chạy đạt, chưa tái hiện lại lỗi này.
Cần kiểm tra cold start khi diễn tập trên máy đích.

Artifact cục bộ bị gitignore: `.local/smoke_models.py`, `model-smoke.json`,
`synthetic-plate.jpg`, `http-smoke.json`, `parking-smoke.backup`. Không đưa backup
hoặc credentials vào báo cáo công khai.

## Chưa có bằng chứng

Chưa có tập test gán nhãn, so sánh OCR, webcam/video thật hoặc nghiệm thu với
người vận hành. Các chỉ tiêu trong kế hoạch v2 về nhận diện ngoài thực tế chưa
được đánh dấu hoàn tất. Spec v1 được tham chiếu cũng chưa có để đối chiếu DTO.
