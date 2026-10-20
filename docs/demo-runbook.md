# Diễn tập demo offline

## Workspace đã chuẩn bị

Cụm PostgreSQL riêng tại `.local/pg-data`, chỉ nghe `127.0.0.1:55432`; không sửa
dịch vụ PostgreSQL 18 có sẵn. `.env` và `.env.test` trỏ đến cụm này. Local trust
chỉ dùng cho cụm demo/thử nghiệm này. Database `parking` phục vụ demo,
`parking_test` dành riêng cho test schema. Nếu cụm đang tắt, chạy tại gốc repo:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D "$PWD\.local\pg-data" -l "$PWD\.local\postgres.log" -o '-h 127.0.0.1 -p 55432' -w start
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Máy khác làm theo README để tạo DB/role với mật khẩu riêng. Nếu
`.local/demo-credentials.txt` tồn tại, thông tin đăng nhập demo của workspace
nằm trong file đó; không đưa file này vào commit hoặc báo cáo.

## Trước thuyết trình

1. Cài dependency, build frontend, chuẩn bị weights, EasyOCR cache và video mẫu
   hợp pháp trước khi ngắt mạng. Repo không kèm video mẫu hoặc tập đánh giá.
2. Khởi động PostgreSQL, backend một worker, mở `http://127.0.0.1:8000`.
3. `GET /api/v1/health` trả `{"status":"ok"}`; đây chỉ là health của tiến trình,
   không chứng nhận DB/model. Đăng nhập và tải danh sách để kiểm tra DB.
4. AI thật cần `USE_STUB=false`, weights/cache và dependency đầy đủ. Thiếu model
   trả lỗi rõ; không tự tải. AI giả lập chỉ chứng nhận tích hợp, không accuracy.
5. Cho phép camera trên localhost. Thử từ chối quyền, chọn video cục bộ hoặc
   nhập biển thủ công kèm lý do; mọi nguồn thủ công/sửa OCR có audit.

## Luồng trình bày

1. Admin kiểm tra giá, tạo Staff; đăng nhập Staff.
2. ENTRY: nhận dạng, chọn bbox khi có nhiều biển, nhân viên bấm xác nhận. Sửa OCR
   cần lý do. Nếu camera lỗi, xác nhận thủ công `51F12345` với lý do rõ.
3. Kiểm tra xe vào, xem cảnh báo rồi ghi nhận xe vào. Một xe chỉ có một ACTIVE.
   Khi mất phản hồi, bấm thử lại cùng yêu cầu để giữ Idempotency-Key; backend
   replay giao dịch đã commit kể cả khi xác nhận nhận diện vừa hết hạn.
4. Biển hư cấu `51F12346` tạo cảnh báo PENDING. Hủy/kiểm tra lại vẫn giữ cùng
   cảnh báo. Với nguồn camera/video, mở ảnh cắt biển số; ảnh vẫn còn sau khi hủy
   nhận diện. Nhập thủ công không có ảnh. Ghi chú và kết quả review bắt buộc.
   Staff quyết định xử lý `REVIEWED`/`FALSE_POSITIVE` trước khi tiếp tục.
5. EXIT: xác nhận biển số mới, chọn ACTIVE, xem phí. Nếu chọn lượt khác biển đã
   xác nhận phải có lý do. Chọn CASH/TRANSFER, đánh dấu đã nhận đủ tiền, rồi ghi
   nhận xe ra. Không kết nối cổng thanh toán thật.
6. Phí đổi sau preview: `409 FEE_CHANGED`, lượt vẫn ACTIVE. UI tải phí mới và
   yêu cầu xác nhận thu tiền lại. Nếu giao dịch trước đã thành công nhưng phản
   hồi mất, thử lại cùng khóa trả kết quả đã lưu, không thu tiền hai lần.
7. Admin xem lịch sử/audit và tạo phiên bản giá. Lượt đang gửi giữ snapshot cũ.
   Vehicle đang ACTIVE không được sửa. Audit không chứa password/JWT/CSRF.

Phí: tính thời gian liên tục qua nửa đêm, làm tròn phút lẻ lên rồi lên bước giá;
dùng Decimal và half-up đến VND nguyên. 70 phút, 5.000đ/giờ, bước 30 phút =
7.500đ; 95 phút = 10.000đ. Không có phí tối thiểu.

## Sao lưu/khôi phục

Dùng `-f` để ghi backup nhị phân, tránh chuyển hướng nhị phân của PowerShell 5.
Dừng backend trước khi khôi phục. Khôi phục vào DB **mới**, kiểm tra trước khi
đổi DATABASE_URL; không xóa DB đang chứa dữ liệu:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h 127.0.0.1 -p 55432 -U postgres -d parking -F c -f .local/parking.backup
& 'C:\Program Files\PostgreSQL\18\bin\createdb.exe' -h 127.0.0.1 -p 55432 -U postgres parking_restore
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' -h 127.0.0.1 -p 55432 -U postgres -d parking_restore .local/parking.backup
```

Restart backend làm mất RecognitionSession/xác nhận RAM: thu nhận lại. Parking,
alerts, ảnh cắt cảnh báo, audit, AuthSession và idempotency đã commit vẫn ở DB.
`init` là bootstrap ban đầu, không thay thế migration nâng cấp schema đã vận hành.

## Bằng chứng còn cần bổ sung

Kết quả test/build và smoke model được ghi trong `docs/implementation-progress.md`.
Webcam vật lý, video thật, tập biển gán nhãn, accuracy, phân bố latency/FPS trên
dữ liệu thực và diễn tập mất Internet với người vận hành cần kiểm tra riêng.
Không coi smoke bằng ảnh tổng hợp hoặc test mock là nghiệm thu chất lượng model.
Ảnh cảnh báo nằm trong DB demo, cần bảo vệ và quyết định thời hạn giữ trước khi
dùng dữ liệu thật; MVP không tự xóa lịch sử. Nhân viên vẫn có thể nhập/xác nhận
sai biển; audit ghi nguồn và lý do, không chứng nhận danh tính người điều khiển.
