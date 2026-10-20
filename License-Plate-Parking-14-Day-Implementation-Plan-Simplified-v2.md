# License Plate Parking — Simplified MVP Implementation Plan (14 days)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhóm 4 người hoàn thiện demo offline trên laptop Windows trong 14 ngày: webcam → nhận diện biển số → nhân viên xác nhận → kiểm tra watchlist/cảnh báo → check-in/out, tính phí, xác nhận thu tiền, xem lịch sử.

**Architecture:** Giữ nguyên repo và AI `src/` hiện hữu, mở rộng FastAPI trong `app/` với các file nghiệp vụ nhỏ, React/Vite trong `frontend/` và PostgreSQL cục bộ. Không tách thành nhiều package `routers/services/schemas/repositories` cho MVP; vẫn giữ transactional boundaries, RBAC, audit và idempotency đã duyệt.

**Tech Stack:** Python, FastAPI, PostgreSQL, SQLAlchemy, pytest, YOLO, OCR pretrained, OpenCV; React, TypeScript, Vite, Tailwind; webcam qua getUserMedia. Thư viện migration/validation/tests có thể bổ sung tối thiểu khi cần, nhưng không đổi stack.

**Spec:** `docs/superpowers/specs/2026-10-13-license-plate-parking-design.md` (đích khi đưa tài liệu System Design Spec v1 đã duyệt vào repo; bản đính kèm `System-Design-Spec-v1-License-Plate-Parking.md`).

**State:** KẾ HOẠCH ĐIỀU CHỈNH ĐỂ REVIEW — KHÔNG TRIỂN KHAI CODE, KHÔNG SỬA REPO, KHÔNG COMMIT.

## Global Constraints

- Demo localhost **offline** trên Windows Intel CPU, GPU tích hợp, 16GB RAM; một webcam cho cả ENTRY/EXIT.
- Mọi biển số đều cần Staff xác nhận trước khi gửi nghiệp vụ. Frame gửi tuần tự. RecognitionSession RAM trong một worker, COLLECTING 15 giây/READY 60 giây; trường hợp đa biển phải chọn bbox mục tiêu.
- Database giữ 9 bảng đã chốt: `User`, `AuthSession`, `Vehicle`, `ParkingSession`, `PricingPolicy`, `StolenVehicle`, `AlertEvent`, `AuditLog`, `IdempotencyRecord`. Không xóa bảng chỉ vì tree code được rút gọn.
- Auth: JWT HttpOnly 8h, AuthSession revocation, CSRF, Argon2id; Admin/Staff.
- Parking: chỉ một ACTIVE/Vehicle; idempotency key cho check-in/out; snapshot chính sách giá; VND dùng integer/Decimal; checkout thu thủ công CASH/TRANSFER, kiểm tra `expectedFee` và trả `409 FEE_CHANGED` khi khác.
- Watchlist: check trước khi hoàn tất check-in; `AlertEvent` độc lập với kết quả check-in; review trạng thái `PENDING`/`REVIEWED`/`FALSE_POSITIVE`, ghi chú bắt buộc; uniqueness `(sourceEventId, stolenVehicleId)`.
- Admin sửa Vehicle có audit, không sửa Vehicle đang ACTIVE; PricingPolicy được version hóa bất biến; Audit Log append-only, query Admin-only, không lưu secrets.
- API prefix `/api/v1`; endpoint theo Auth v1, Recognition v1, Parking v1, StolenVehicle & Alert v1, Pricing/Vehicle/Audit v1 đã duyệt.
- Chạy local từ mã nguồn repo; không phụ thuộc Internet hoặc dịch vụ cloud khi thuyết trình. Lưu model weights đã chuẩn bị trước; không commit dataset, video hoặc model nặng nếu không có chủ đích.

## Directory ownership map — minimal structure

```text
license_plate_detection/
├── app/
│   ├── main.py                # Giữ FastAPI entrypoint đã có; include routers
│   ├── database.py            # Dev 2: PostgreSQL session/engine
│   ├── models.py              # Dev 2: 9 bảng + ràng buộc
│   ├── auth.py                # Dev 2: JWT, CSRF, roles, AuthSession
│   ├── recognition.py         # Dev 1: recognition endpoints + RAM sessions
│   ├── parking.py             # Dev 2: check-in/out, precheck, pricing snapshot
│   ├── alerts.py              # Dev 4: watchlist, reviews, event dedup
│   └── admin.py               # Dev 2+4: pricing, vehicle, audit, user APIs
├── src/                       # Dev 1: GIỮ các file AI có sẵn
│   ├── config.py
│   ├── detector.py
│   ├── ocr.py
│   ├── postprocess.py
│   └── pipeline.py
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── Camera.tsx
│   │   ├── ParkingPage.tsx
│   │   └── AdminPage.tsx
│   ├── package.json
│   └── vite.config.ts
├── models/                    # Weights local, kèm hướng dẫn tải/chuẩn bị
├── data/                      # Fixtures/demo không nhạy cảm
├── notebooks/                 # Tái sử dụng notebook hiện tại
├── tests/                     # Giữ tests cũ, thêm test nghiệp vụ và API
├── docs/superpowers/{specs,plans}/
├── .env.example
├── .gitignore
├── requirements.txt
├── requirements-dev.txt
├── pytest.ini
└── README.md
```

**Lưu ý:** Đây là cây *đích*, không phải cây hiện đã tồn tại. Nhánh `develop` đã có `app/main.py`, `src/*`, `tests/*`, `models/`, `data/`, `notebooks/`. Giữ lại `tests/test_app.py`, `tests/test_ocr.py`, `tests/test_pipeline.py`, `tests/test_postprocess.py` và notebook YOLO hiện có; không reset/di chuyển AI vô ích. `docs/` hiện hữu tiếp tục được giữ.

## Review Focus — 5 trường hợp bắt buộc test

1. Trùng request hoặc check-in đồng thời: một ACTIVE duy nhất; cùng idempotency key + payload phải replay; khác payload trả 409 (**T5**).
2. RecognitionSession quá hạn, target bbox đổi, fake source ID: không được dùng dữ liệu mất hiệu lực để bypass precheck (**T3, T6**).
3. Precheck match watchlist nhưng chưa review, retry precheck, hủy check-in: alert vẫn duy nhất và còn lịch sử (**T6, T8**).
4. Qua ngày, policy đổi giữa chừng, rounding tiền VND, preview và checkout khác phí: dùng snapshot, từ chối nếu expectedFee sai (**T4, T7**).
5. Webcam bị từ chối/AI load fail/mất Internet: UI có lỗi rõ, fallback video chuẩn bị sẵn hoặc xác nhận nhập biển số thủ công có audit (**T10, T12**).

## Work allocation and milestones

| Day | Dev 1 — AI | Dev 2 — Backend | Dev 3 — Frontend | Dev 4 — Alert & QA | Gate |
|---|---|---|---|---|---|
| D1 | Run AI tests, inventory weights | Verify Python/DB, 9 tables | React/Vite shell | API/test checklist + fixtures | Repo baseline runs |
| D2 | OCR baseline + samples | Models, migrations, Auth start | Camera permission UI | Mock API + integration fixtures | Freeze DTO/OpenAPI |
| D3 | Postprocess/benchmark | Auth/roles/CSRF | Login + API client | Alert matching unit tests | Auth works |
| D4 | Recognition session API | Parking schema + policy math | Mode ENTRY/EXIT + plate editor | Alert CRUD and review | Frame → candidates |
| D5 | Weighted voting/target | Precheck/check-in transaction | Check-in UI mocked | Dedup AlertEvent + tests | Core unit tests |
| D6 | Link actual AI to API | Backend check-in complete | Connect real check-in | Cross-module validation | E2E dry run |
| **D7** | **Stabilize recognition** | **Persist ACTIVE** | **Live webcam flow** | **Integrated smoke tests** | **Vertical slice demonstrated** |
| D8 | CPU benchmark/fix | Fee preview + checkout | Checkout UI | Watchlist review UI | Checkout basic |
| D9 | OCR edge cases | Snapshot + idempotent checkout | Payment confirm UI | Watchlist integration | Fee flow passes |
| D10 | Freeze model | Admin vehicle/pricing endpoints | Admin UI minimal | Audit API + integration | Full flow |
| D11 | Low-light/two-line tests | Auth/DB regressions | Loading/error handling | E2E & concurrency tests | RC test |
| D12 | Offline weights check | Restore/seed and migrations | Offline browser build | Security, integration regression | Release candidate |
| D13 | Demo video/fallback | Seed sample and runbook | UX cleanups only | Rehearsal + bug triage | Offline rehearsal |
| D14 | Demo support | DB support | Demo operator | Test evidence/report | Final presentation |

Mỗi người tích hợp tối thiểu một lần/ngày. Nếu D5-D7 trễ: đóng băng admin UI đẹp, tối ưu model và thống kê; không bỏ data integrity, alert review, hoặc auth. Nếu model yếu: Staff có thể sửa OCR; demo dùng video mẫu được chuẩn bị offline. Không giả vờ đã đạt accuracy chưa đo.

## Tasks (triển khai qua TDD; mỗi task là một PR hoặc nhóm commit reviewable)

### T1 — D1–D2: Environment, baseline and API DTO freeze (Dev 2 + Dev 4)
**Files:** modify `app/main.py`, `requirements*.txt`, `.env.example`, `README.md`; preserve existing tests; add `tests/test_health.py`; create `docs/api-contract.md` if needed.
**Interfaces:** `GET /api/v1/health -> {"status":"ok"}`; server runs local one worker; frontend proxy `/api`.
- [ ] Write failing `tests/test_health.py::test_health_ok`: GET health ==200, payload `status=ok`.
- [ ] Run `python -m pytest tests/test_health.py -q`, verify FAIL.
- [ ] Wire health endpoint and local config; identify exact existing AI test interfaces; freeze shared `plateNumber`, `vehicleType`, UUID, timestamps, error shape.
- [ ] Run `python -m pytest -q`, verify baseline passes and document any pre-existing failures.
- [ ] Commit baseline/config + DTO documentation.

### T2 — D1–D3: PostgreSQL schema and Auth (Dev 2)
**Files:** create `app/database.py`, `app/models.py`, `app/auth.py`; `tests/test_auth.py`, `tests/test_models.py`; modify `app/main.py`.
**Interfaces:** DB session factory `get_db()`; models exactly 9 tables; `/api/v1/auth/csrf`, `login`, `logout`, `me`, `password`; Admin users endpoints under `/api/v1/users`.
- [ ] Write failing model constraint tests: unique ACTIVE session, key/fingerprint uniqueness, alert source dedup; auth tests wrong password ->401, Staff forbidden Admin actions ->403, CSRF missing ->403, revoked session ->401.
- [ ] Run `python -m pytest tests/test_models.py tests/test_auth.py -q`, verify FAIL.
- [ ] Implement tables, migration reproducibility, Argon2id/JWT HttpOnly/CSRF, server-side AuthSession revocation; keep user management endpoints minimal but compliant with approved Auth contract.
- [ ] Run targeted tests -> PASS; restart DB from empty with migration/seed instructions.
- [ ] Commit schema + auth.

### T3 — D2–D5: Recognition pipeline, session and voting (Dev 1)
**Files:** modify existing `src/detector.py`, `src/ocr.py`, `src/postprocess.py`, `src/pipeline.py`; create `app/recognition.py`; extend `tests/test_ocr.py`, `tests/test_pipeline.py`, create `tests/test_recognition_api.py`; reuse notebook.
**Interfaces:** approved `/api/v1/recognition/sessions` CRUD/frames/target; state `COLLECTING` max 15s, `READY` max 60s; `STABLE` vs `UNCERTAIN`; staff-selected bbox for multi-plate; no DB writes.
- [ ] Write failing tests: one plate stable by weighted voting, multi-plate needs target, expired session rejected, bad plate format not stable; frames ordered.
- [ ] Run `python -m pytest tests/test_recognition_api.py tests/test_pipeline.py -q`, verify FAIL.
- [ ] Reuse existing detector/OCR/postprocess; add RAM state and voting; select best OCR via labeled mini-eval; export model usable offline.
- [ ] Run targeted tests -> PASS; measure CPU per-frame latency on target laptop (record real values, no invented benchmark).
- [ ] Commit AI + Recognition contract.

### T4 — D3–D5: Immutable pricing and VND fee calculation (Dev 2)
**Files:** `app/parking.py`, `app/models.py`, `tests/test_pricing.py`.
**Interfaces:** `calculate_fee(duration_minutes: int, hourly_rate: Decimal, rounding_minutes: int) -> int`; `PricingPolicy` immutable version; snapshot on check-in.
- [ ] Write failing tests: `70min, 5000/hour, 30min -> 7500 VND`; cross-midnight continuous time; changed active policy does not affect existing session; exact VND rounding rule documented.
- [ ] Run `python -m pytest tests/test_pricing.py -q`, verify FAIL.
- [ ] Implement Decimal-based integer VND fee; transactional policy rollover, old policy reference intact; reject invalid rates/rounding.
- [ ] Run targeted tests -> PASS.
- [ ] Commit pricing.

### T5 — D4–D7: Check-in and idempotency (Dev 2)
**Files:** `app/parking.py`, `app/models.py`, `tests/test_parking_checkin.py`, modify `app/main.py`.
**Interfaces:** `POST /api/v1/parking-sessions/check-in/precheck` and `POST /api/v1/parking-sessions/check-in`; `Idempotency-Key` required; response ParkingSession ACTIVE; API errors 409 for conflicts.
- [ ] Write failing tests: normalized plate stored, policy snapshot, no duplicate ACTIVE, same-key retry same result, key reused different payload ->409, simultaneous distinct keys one ACTIVE, CSRF/Staff scope enforced.
- [ ] Run `python -m pytest tests/test_parking_checkin.py -q` -> FAIL.
- [ ] Implement atomic DB transaction for vehicle/session/idempotency/audit; precheck gate must be verified server-side per T6.
- [ ] Run targeted tests -> PASS, including live PostgreSQL integration (SQLite-only tests insufficient for row locks/partial indexes).
- [ ] Commit check-in.

### T6 — D4–D7: Precheck security and confirmed recognition (Dev 1 + Dev 4 + Dev 2 integration)
**Files:** `app/recognition.py`, `app/parking.py`, `app/alerts.py`, `tests/test_precheck.py`.
**Interfaces:** `sourceEventId` stable for one staff-confirmed observation; `AlertEvent` unique on `(sourceEventId, stolenVehicleId)`; precheck and check-in tied to server-verified same plate/event.
- [ ] Write failing tests: expired/forged event rejected, different plate after precheck requires new review, pending alert blocks check-in; reviewed alert can proceed subject to Staff decision; retry precheck returns same alert.
- [ ] Run `python -m pytest tests/test_precheck.py -q` -> FAIL.
- [ ] Implement server-side linkage without new DB table: durable event identity in AlertEvent/IdempotencyRecord and short-lived signed confirmation token as needed; check watchlist again in check-in transaction. Keep reviewed alert even after cancelled check-in.
- [ ] Run tests -> PASS with PostgreSQL; check race between watchlist modification and check-in.
- [ ] Commit integration security.

### T7 — D8–D9: Fee preview and payment-confirmed checkout (Dev 2)
**Files:** `app/parking.py`, `tests/test_parking_checkout.py`.
**Interfaces:** `POST /api/v1/parking-sessions/{id}/fee-preview`; `POST /api/v1/parking-sessions/{id}/check-out`; `paymentMethod=CASH|TRANSFER`, `paymentConfirmed=true`, `expectedFee`, `Idempotency-Key`.
- [ ] Write failing tests: cannot check out inactive session, 95min/30min/5000 -> 10000; fee mismatch ->409 FEE_CHANGED without update, manual session selection requires reason, same-key retry no double checkout.
- [ ] Run `python -m pytest tests/test_parking_checkout.py -q` -> FAIL.
- [ ] Implement lock/check/check-out including payment fields, snapshot fee, idempotency and audit in a single DB transaction.
- [ ] Run targeted tests -> PASS with PostgreSQL.
- [ ] Commit checkout.

### T8 — D4–D10: Watchlist and alert lifecycle (Dev 4)
**Files:** `app/alerts.py`, `tests/test_alerts.py`, `app/models.py` collaboration with Dev 2.
**Interfaces:** approved `/api/v1/stolen-vehicles` CRUD/status and `/api/v1/alerts`, `/api/v1/alerts/{id}/review`; roles; states PENDING, REVIEWED, FALSE_POSITIVE.
- [ ] Write failing tests: only ACTIVE watchlist matches, same `(sourceEventId, stolenVehicleId)` returns one alert, separate event yields new alert, no silent overwrite of reviewed event, review requires nonempty note, Staff cannot edit stolen dossier.
- [ ] Run `python -m pytest tests/test_alerts.py -q` -> FAIL.
- [ ] Implement match/dedup/review with proper audit, snapshot evidence/path and 403 rules; preserve alert if checkout/checkin canceled.
- [ ] Run targeted tests -> PASS and integration precheck tests T6.
- [ ] Commit alert lifecycle.

### T9 — D8–D10: Vehicle, pricing administration and Audit API (Dev 2 + Dev 4)
**Files:** `app/admin.py`, `tests/test_admin.py`, `tests/test_audit.py`.
**Interfaces:** Pricing policies list/get/create version; Vehicle list/get/history/Admin patch; Audit GET/list and filters actorId/action/entityType/entityId/date/page.
- [ ] Write failing tests: Staff edit Vehicle ->403, Admin edits ACTIVE ->409, old snapshots unchanged, pricing rollover atomic, audit filters/pagination work and never expose secrets.
- [ ] Run `python -m pytest tests/test_admin.py tests/test_audit.py -q` -> FAIL.
- [ ] Implement minimal endpoints from approved contracts and audit writes (append-only); reuse `app/models.py` with no extra layers.
- [ ] Run targeted tests -> PASS.
- [ ] Commit admin endpoints.

### T10 — D1–D7: Minimal React webcam + check-in (Dev 3)
**Files:** create `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/{main.tsx,App.tsx,api.ts,Camera.tsx,ParkingPage.tsx}`; minimal frontend tests if feasible.
**Interfaces:** `api.ts` typed `fetch` + same-origin Vite proxy `/api`, credentials included, CSRF header, sequential frame submit; Staff selects ENTRY/EXIT; plate candidate editable.
- [ ] Write failing UI test: camera permission denied shows error; edit recognized plate before check-in; repeated click disabled while request in flight.
- [ ] Run `cd frontend && npm test -- --run` -> FAIL (test tooling bootstrapped within this task).
- [ ] Implement Camera and ParkingPage calling recognition/precheck/check-in; show pending watchlist review gate; no UI auto-confirm.
- [ ] Run tests -> PASS; manually demonstrate using local webcam on Windows D7.
- [ ] Commit initial UI.

### T11 — D8–D10: Checkout, Admin and Alert React UI (Dev 3)
**Files:** modify `frontend/src/{App.tsx,ParkingPage.tsx,AdminPage.tsx,api.ts}`.
**Interfaces:** checkout preview, `expectedFee`, CASH/TRANSFER manual confirm; alert panel notes review; basic list pages for user/vehicle/pricing/history; Admin-only audit list.
- [ ] Write failing UI tests: missing payment confirmation prevents checkout, FEE_CHANGED refreshes fee, pending alert requires review, Staff cannot access Admin controls.
- [ ] Run frontend tests -> FAIL.
- [ ] Implement minimal UI: tables/forms, no advanced routing/state-management library unless truly needed.
- [ ] Run tests -> PASS; integrated check-out demo.
- [ ] Commit UI completion.

### T12 — D6–D14: QA integration, offline rehearsal and handoff (Dev 4 lead; all devs)
**Files:** `tests/test_integration.py`, `README.md`, `data/` demo fixtures, `.env.example`, `docs/demo-runbook.md`; existing `tests/*` retained.
**Interfaces:** end-to-end scenario check-in normal, check-in alert review, checkout + payment, manual correction, retry/error, offline restore; test evidence annotated.
- [ ] Write failing integration tests for normal flow and duplicate/expiry/alert review; add expected assertions to test cases in Review Focus.
- [ ] Run `python -m pytest -q` and frontend test command; fix only within task ownership, verify regression PASS.
- [ ] Verify Windows local DB setup, model path, no internet during runtime, webcam permissions; build frontend offline and prepare local video/fixture fallback; document startup/restore commands.
- [ ] Perform D7 vertical slice, D10 full flow, D13 rehearsal, D14 final test; record measured FPS/latency/plate accuracy and known limitations truthfully.
- [ ] Commit tests/runbook/demo assets (small, non-sensitive files only).

## Definition of Done

- [ ] Windows laptop can start PostgreSQL, FastAPI, React without internet after pre-installation and local model provisioning.
- [ ] Webcam recognizes at least one Vietnamese car/motorbike sample and Staff confirms/corrects plate.
- [ ] Check-in creates exactly one ACTIVE session; watchlist precheck and review cannot be skipped; retry safe.
- [ ] Checkout computes snapshot fee, requires manually acknowledged CASH/TRANSFER, updates COMPLETED exactly once.
- [ ] Admin can manage watchlist/pricing/vehicle, inspect paginated Audit Log; Staff access restricted.
- [ ] Existing AI tests plus new backend/integration/frontend tests are green; demo script rehearsed, offline fallback documented.
- [ ] Model quality, OCR accuracy, CPU latency are measured and limitations stated; no unsupported performance claims.

## Risk controls / defer-first (without changing approved data safeguards)

- **Never defer:** check-in/out atomicity, confirmed plate, idempotency, watchlist precheck/review, fee correctness, session/auth security, audit on privileged actions.
- **Reduce polish first:** advanced dashboard design, charts, elaborate filters UI, multiple alert panels, OCR tuning beyond measured baseline, automated report exports (not in MVP).
- **If real OCR weak:** permit Staff to manually correct plate and clearly report its contribution; keep offline prerecorded sample as reliable backup.
- **If behind by D7:** stop new admin visual features; focus on check-in vertical slice. Resolve missing contract integrations as blockers; don't replace PostgreSQL with SQLite or silently drop security controls.

## Execution handoff

This plan is for review and assignment only. Confirm the 4 owners, whether D1 starts on a weekday or calendar day, and repo file ownership. **Do not scaffold, code, commit, or modify GitHub until review and explicit execution approval.**
