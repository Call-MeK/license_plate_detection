# OCR benchmark sơ bộ

Ngày 2026-10-29, so sánh EasyOCR hiện tại với LiteALPR 0.1.7 (SVTR26 Tiny ONNX)
trên CPU. Cả hai nhận cùng 20 ảnh biển tổng hợp đã cắt: 5 biển một dòng và
5 biển hai dòng, mỗi biển được thử ở bản rõ và bản làm mờ Gaussian 0,8 pixel.
Đáp án được tạo cùng ảnh; chấm đúng khi toàn bộ chuỗi chuẩn hóa khớp. Thời gian
là trung bình OCR trên từng ảnh sau một lượt làm nóng, không gồm phát hiện biển.

| OCR | Một dòng | Hai dòng | Thời gian trung bình một dòng / hai dòng |
| --- | --- | --- | --- |
| EasyOCR trước sửa `6 → G` | 8/10 | 10/10 | 1,531 / 1,578 giây |
| EasyOCR sau sửa `6 → G` | 10/10 | 10/10 | 1,577 / 1,546 giây |
| LiteALPR, chạy trực tiếp cả ảnh biển | 2/10 | 0/10 | 0,214 / 0,170 giây |

Môi trường: Python 3.14, PyTorch 2.14.1+cpu, EasyOCR 1.7.2,
ONNX Runtime 1.31.1. LiteALPR OCR `best.onnx` có SHA-256
`cbd50929d59f6c24f500d1d499fdc7719533186ed2713e3f86541b379955a7c7`;
[model card](https://huggingface.co/anhone3/LiteALPR) công bố giấy phép AGPL-3.0
và lưu ý hạn chế với biển nhiều dòng.

Đây là kiểm tra sàng lọc, không đo accuracy thực tế, detector hoặc toàn bộ luồng
camera. Ảnh là tổng hợp, chỉ có 10 biển duy nhất; LiteALPR chưa được thử với
phương án tách dòng hoặc tinh chỉnh. Cần kiểm tra trên tập biển Việt Nam thật,
có nhãn và độc lập với dữ liệu huấn luyện, trước khi kết luận model nào tốt hơn.
Script và kết quả từng ảnh được lưu cục bộ tại `.local/benchmark_ocr.py` và
`.local/benchmark_download/synthetic_results.json`.

## Thử tiền xử lý OCR

Trên cùng 20 ảnh tổng hợp ở trên, so sánh EasyOCR trước thay đổi với lần đọc
ảnh gốc có allowlist gồm chữ, số, `-`, `.` và thử lại khi không hợp lệ hoặc điểm
dưới 0,6. Mỗi giá trị đo trên CPU sau làm nóng, không gồm detector:

| Chỉ số | Trước | Sau |
| --- | ---: | ---: |
| Khớp toàn biển | 20/20 | 20/20 |
| Chuỗi không hợp lệ | 0/20 | 0/20 |
| Thời gian trung bình | 1,562 giây | 1,609 giây |
| p95 thời gian | 1,700 giây | 1,731 giây |
| Số lượt gọi EasyOCR | 20 | 20 |

Không có ảnh nào trong mẫu kích hoạt lần thử thứ hai, do đó bảng này không đo
chi phí hoặc hiệu quả của lần thử đó. Khi chỉ cho phép chữ và số, không cho phép
dấu phân cách, kết quả giảm còn 10/20 dù cả 20 chuỗi đều hợp lệ theo mẫu; OCR
đôi khi đọc dấu gạch thành chữ hoặc số. Các dấu `-` và `.` vì vậy được phép trong
OCR và loại bỏ khi chuẩn hóa. Kết quả tổng hợp không chứng minh accuracy thực tế.
