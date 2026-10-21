# PostgreSQL trên Windows: thiết lập và migration

Chạy PowerShell tại gốc repo. Cài Python, Node.js 22 và PostgreSQL kèm pgAdmin;
chuẩn bị dependency và model trước khi demo offline. Không cần Docker trên máy demo.

## Tạo database bằng pgAdmin

1. Mở pgAdmin, chọn server PostgreSQL đang chạy. Nếu chưa có server: Register →
   Server, Connection: Host `127.0.0.1`, Port theo bản PostgreSQL đã cài (thường
   `5432`), Maintenance database `postgres`, Username tài khoản quản trị đã tạo
   lúc cài đặt. Nhập mật khẩu của bạn.
2. Login/Group Roles → Create → Login/Group Role: tên `parking`; Definition đặt
   mật khẩu riêng; Privileges bật **Can login**, không bật Superuser.
3. Databases → Create → Database: tên `parking`, Owner `parking`.
   Lặp lại cho `parking_test`, Owner `parking`. Không thay thế database đã tồn tại.
4. Mở Query Tool trên từng database và chạy:

   ```sql
   SELECT current_database(), inet_server_addr(), inet_server_port();
   SELECT 1;
   ```

`parking` giữ dữ liệu ứng dụng, `parking_test` chỉ dùng kiểm thử. Fixture kiểm tra
tên database thực tế trước khi tạo schema `test_<uuid>`; chỉ schema tạm đó bị xóa
sau test. Nếu thiếu DB, sai URL hoặc thiếu quyền tạo schema, test **FAIL**, không SKIP.

## Cấu hình

Nếu chưa có môi trường Python/frontend:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
cd frontend
npm.cmd ci
npm.cmd run build
cd ..
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Điền `.env` bằng giá trị riêng trên máy:

```dotenv
DATABASE_URL=postgresql+psycopg://parking:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/parking
JWT_SECRET=YOUR_PERSISTENT_RANDOM_SECRET
COOKIE_SECURE=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=YOUR_OWN_PASSWORD_AT_LEAST_12_CHARACTERS
USE_STUB=true
PLATE_MODEL=models/plate_detector.pt
OCR_MODEL_DIR=models/easyocr
```

Sinh `JWT_SECRET` một lần bằng lệnh sau, lưu kết quả vào `.env`:

```powershell
.\.venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

Trong `.env.test` chỉ cần dòng sau, thay mật khẩu/cổng thực tế:

```dotenv
TEST_DATABASE_URL=postgresql+psycopg://parking:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/parking_test
```

Ký tự đặc biệt trong mật khẩu của URL phải percent-encode (ví dụ `@` → `%40`,
`#` → `%23`, `%` → `%25`). Không commit hai file này. Biến môi trường PowerShell
đã đặt sẽ được ưu tiên hơn `.env`/`.env.test`; kiểm tra lại nếu đổi cấu hình mà
ứng dụng vẫn kết nối cổng cũ. Xóa override không còn dùng bằng
`Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue`.

Kiểm tra kết nối **chỉ đọc**, chỉ in host/cổng/tên DB, không in URL có mật khẩu:

```powershell
.\.venv\Scripts\python.exe -m app.database check --expect-database parking
```

Nếu lỗi: kiểm tra dịch vụ PostgreSQL trong Services, cổng ở pgAdmin, role/mật khẩu,
tên DB và quyền CONNECT/schema. Nếu tên đích khác dự kiến, dừng trước khi init/seed/migrate.

## Database mới

Chỉ dùng `init` cho bootstrap schema mới. `create_all()` không nâng cấp bảng cũ.

```powershell
.\.venv\Scripts\python.exe -m app.database check --expect-database parking
.\.venv\Scripts\python.exe -m app.database init --expect-database parking
.\.venv\Scripts\python.exe -m app.database seed-admin --expect-database parking
.\.venv\Scripts\python.exe -m app.database seed-demo --expect-database parking
```

Giữ 9 bảng. Không có mật khẩu Admin mặc định; seed từ chối ghi đè tài khoản đã có.
Xóa `ADMIN_PASSWORD` khỏi `.env` sau khi tạo Admin. `seed-demo` chỉ thêm giá/watchlist
hư cấu còn thiếu, không thay thế dữ liệu đã có.

## Database cũ: migration decision không mất dữ liệu

Dừng backend; sao lưu bằng pgAdmin (database → Backup → Format Custom), hoặc
dùng `pg_dump.exe -h 127.0.0.1 -p <PORT> -U parking -d parking -F c -f .local/parking-before-decision.backup`.
Không dùng chuyển hướng nhị phân `>` với PowerShell 5. Giữ backup ở thư mục riêng tư.

Trước hết kiểm thử migration trên `parking_test` (schema mới và schema cũ có alert
mẫu được tạo tự động; không đọc/ghi database demo):

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_database.py tests/test_health.py tests/test_auth.py tests/test_alerts.py -q -rs
```

Sau khi đã xác nhận đúng database cần nâng cấp, chạy:

```powershell
.\.venv\Scripts\python.exe -m app.database check --expect-database parking
.\.venv\Scripts\python.exe -m app.database migrate --expect-database parking
```

Migration nằm trong `app/database.py::migrate_db`, chạy trong một transaction,
chỉ thêm cột nullable `decision VARCHAR(10)` bằng `ADD COLUMN IF NOT EXISTS` và
CHECK `alert_decision_valid`. Chạy lại an toàn; không tạo bảng metadata migration,
không DROP bảng/DB, không UPDATE/DELETE record, không chạy tự động lúc startup.
Lock timeout 5 giây: nếu đang có giao dịch giữ lock, lệnh thất bại và rollback;
dừng backend, chờ giao dịch kết thúc rồi chạy lại. Ràng buộc được VALIDATE khi
không có giá trị cũ sai; nếu đã có giá trị sai, giữ nguyên chúng, CHECK ở trạng thái
NOT VALID nhưng áp dụng cho các lần ghi mới. Sau xử lý dữ liệu theo quy trình được
phê duyệt, chạy lại migration để validate.

**Alert cũ không được tự động ALLOW**, kể cả `REVIEWED` hoặc `FALSE_POSITIVE`.
Cột mới để NULL; trạng thái, note, evidence, người/thời gian review được giữ nguyên.
Gate chỉ cho qua khi alert đã review và `decision == 'ALLOW'`; NULL/giá trị sai/BLOCK
đều chặn. Migration in số review lịch sử chưa có quyết định hợp lệ.

Tra cứu thủ công bằng Query Tool trên đúng database:

```sql
SELECT id, source_event_id, plate_number, status, note, reviewed_at, reviewed_by
FROM alert_events
WHERE status <> 'PENDING'
  AND (decision IS NULL OR decision NOT IN ('ALLOW','BLOCK'));
```

Không sửa SQL để gán hàng loạt ALLOW và không ghi đè review cũ. Với alert PENDING,
Staff review bình thường trên UI, chọn quyết định và ghi chú. Với review lịch sử
thiếu quyết định, người phụ trách kiểm tra hồ sơ, giữ lịch sử cũ; Staff bắt đầu một
quan sát/xác nhận mới (dừng và bắt đầu nhận dạng lại, hoặc xác nhận thủ công có lý do
nhắc ID alert cũ). Precheck mới tạo alert mới cho watchlist còn ACTIVE; review mới
ghi quyết định ALLOW/BLOCK cùng lý do và audit. Không tắt watchlist để vượt gate.

## Chạy và kiểm tra trước demo

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Mở `http://127.0.0.1:8000` sau khi frontend đã build. Khi phát triển, mở terminal
thứ hai tại `frontend`, chạy `npm.cmd run dev`, truy cập địa chỉ Vite hiển thị.
Backend phải giữ một worker vì RecognitionSession nằm trong RAM.

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/ready
.\.venv\Scripts\python.exe -m pytest -q -rs
cd frontend
npm.cmd test -- --run
npm.cmd run build
```

`health` chỉ báo tiến trình; `ready` chạy SELECT 1, không chứng nhận schema/model.
Login lỗi thiếu bảng/cột trả 503 `DATABASE_SCHEMA_REQUIRED`; DB mất kết nối trả
503 `DATABASE_UNAVAILABLE`, không trả nội dung lỗi SQL hay credentials.

Frontend resize giữ tỷ lệ, tối đa 1920×1080, nén JPEG đến tối đa 2 MiB rồi mới gửi;
sequence tăng tuần tự sau từng request, bbox hiển thị theo kích thước frame đã gửi.
Nếu không nén được trong giới hạn, UI dừng với hướng dẫn video/nhập thủ công.
Lỗi camera, INVALID_FRAME, 413 và AI_UNAVAILABLE không tự xác nhận biển số.

`USE_STUB=true` hiển thị dữ liệu giả lập trên UI. Muốn AI thật: chuẩn bị
weights/cache theo `models/README.md`, đặt false, khởi động lại backend. Không tự
tải model khi chạy demo. CI chỉ kiểm thử logic, không chứng nhận accuracy/FPS.
