# Execution ledger — plan: License-Plate-Parking-14-Day-Implementation-Plan-Simplified-v2.md

- Baseline: develop, normal checkout; 19 existing tests pass (2026-10-19).
- Ruling: The user's request to implement supersedes the plan's review-only state. Work stays in the supplied checkout; no commits, pushes, or database deletion.
- Ruling: Referenced System Design Spec v1 is not present. Use explicit plan constraints plus docs/api-contract.md; exact compatibility with the missing spec requires later comparison.
- Scope: retain AI signatures and Streamlit video behavior; add FastAPI, nine-table PostgreSQL schema, auth, recognition, parking, watchlist/admin, React UI, tests and local runbook.
- Shared interfaces: T2 models/auth -> T3/T5/T8/T9; T3 verified observations -> T6/T7; T4 pricing snapshots -> T5/T7; T6/T8 review gate -> T5; docs/api-contract.md -> T10/T11. DTOs fixed before parallel file ownership.
- T1/T2: backend foundation assigned; T3: recognition assigned; T10/T11: frontend assigned. Root owns T4–T9 business integration and T12 verification/docs.
- Runtime prerequisites: PostgreSQL 18 service exists; FastAPI/SQLAlchemy/auth packages missing initially; no local model weights.

## Kết quả đến 2026-10-20

| Phần | Kết quả |
| --- | --- |
| T1–T2 | FastAPI health/error contract, 9 bảng PostgreSQL, bootstrap schema/Admin, JWT/Argon2id/CSRF, thu hồi session, RBAC và quản lý user |
| T3 | Session RAM, voting, bbox mục tiêu, TTL, xác nhận/sửa OCR và nhập thủ công; model local chạy được trên ảnh tổng hợp |
| T4–T7 | Giá bất biến/snapshot, precheck có liên kết server, alert gate, check-in/out atomic, idempotency, phí Decimal và xác nhận thu tiền |
| T8–T9 | Watchlist/review, ảnh cắt cảnh báo lưu bền trong DB, hồ sơ xe/lịch sử, giá phiên bản và audit Admin có phân trang/lọc |
| T10–T11 | React UI, camera/video/manual, gửi frame tuần tự, bbox, luồng xác nhận, retry, thu tiền và các trang quản trị |
| T12 | Test tích hợp PostgreSQL, frontend tests/build, live HTTP, backup/restore và runbook; nghiệm thu webcam/dữ liệu thật còn chờ |

Verification đã chạy trên cây code hoàn thiện:

- `.venv/Scripts/python.exe -m pytest -q --tb=short`: **100 passed**, không skip;
  PostgreSQL thật, 30,66 giây. Một warning deprecation từ Starlette/httpx.
- `cd frontend; npm.cmd test -- --run`: **17 passed**; `npm.cmd run build`:
  TypeScript/Vite thành công, JS gzip khoảng 77,6 kB.
- `git diff --check`: không lỗi whitespace; Git cảnh báo quy đổi LF/CRLF trên Windows.
- HTTP thật `127.0.0.1:8000`: frontend/assets 200, health ok, anonymous API 401,
  CSRF HttpOnly, Admin login/logout, nhận dạng ảnh tổng hợp → `51F12345`,
  nhân viên xác nhận rồi hủy session đều thành công.
- `pg_dump`/`pg_restore` vào DB tạm mới: giữ 9 bảng, Admin và hai chính sách giá;
  chỉ DB tạm do lần kiểm tra tạo ra được dọn, DB nguồn giữ nguyên.
- Model thật đã được bổ sung trong workspace (weights/cache vẫn gitignore).
  Hai lần smoke mới chạy với TCP connect/connect_ex bị chặn, YOLO/EasyOCR dùng
  tài sản cục bộ và đọc ảnh tổng hợp. Chi tiết: [verification.md](verification.md).

## Review và quyết định

- Review độc lập không tìm thấy lỗi critical. Đã xử lý hai finding Important:
  audit filter có múi giờ và giữ bộ lọc khi chuyển trang; retry giao dịch vẫn
  gửi cùng payload/key sau khi xác nhận hết hạn để backend replay kết quả đã lưu.
- Đã sửa thêm ranh giới tính tiền: fee và checkOutAt dùng cùng thời điểm;
  regression test đã được quan sát fail rồi pass.
- Đã sửa mã hóa tiếng Việt trên App/Admin; test giao diện kiểm tra các nhãn thực.
- Ruling: Server quyết định hạn xác nhận; không dùng đồng hồ trình duyệt để chặn
  replay. Yêu cầu mới có nguồn hết hạn vẫn bị server từ chối.
- Ruling: Ảnh bằng chứng được cắt tối đa 640×256 và lưu trong JSON của AlertEvent,
  giữ đúng 9 bảng và cùng transaction với alert. API list chỉ trả metadata/path;
  ảnh chỉ xem được khi đăng nhập. Nhập thủ công không có ảnh. Chi phí: DB/backup
  lớn hơn; cần chính sách giữ ảnh khi đưa dữ liệu thật vào vận hành.
- Ruling: `init` là bootstrap schema ban đầu, không là migration nâng cấp dữ liệu
  đang vận hành. Cần migration riêng trước khi đổi schema DB có dữ liệu.
- Giữ tài khoản Admin/cấu hình đã có; không thay mật khẩu, không tạo credentials
  mặc định. Không commit/push/merge các thay đổi của lần triển khai này.

Chưa hoàn tất nghiệm thu: đối chiếu Spec v1 đang thiếu; mini-eval OCR trên dữ liệu
gán nhãn; accuracy/latency/FPS với xe thật; webcam và video thật; diễn tập offline
với người vận hành. Không coi ảnh tổng hợp là bằng chứng cho các tiêu chí này.
