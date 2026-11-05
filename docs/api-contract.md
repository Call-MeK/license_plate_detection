# Local parking API v1

Implementation follows `License-Plate-Parking-14-Day-Implementation-Plan-Simplified-v2.md`.
The referenced System Design Spec v1 is absent; the concrete DTOs below are provisional.
All paths start with `/api/v1`; timestamps are UTC ISO 8601, IDs are UUID strings,
plates are normalized (e.g. `51F12345`), types are `CAR` / `MOTORBIKE`.
Errors use `{"error":{"code":"...","message":"..."}}`. Lists use
`{"items":[],"total":0,"page":1,"pageSize":20}`. Roles are `ADMIN` / `STAFF`.

## Authentication

- GET `/auth/csrf` -> `{csrfToken}`; sends same-site `csrf_token` cookie.
- POST `/auth/login` `{username,password}` -> `{id,username,role}`; sends HttpOnly JWT cookie.
- GET `/auth/me` -> same user DTO. POST `/auth/logout` -> `{ok:true}`.
- POST `/auth/password` `{currentPassword,newPassword}` revokes all sessions.
- Mutations include `X-CSRF-Token` matching server-issued cookie, including login.
- Admin GET/POST `/users`, PATCH `/users/{id}`: `{username,password,role}` / `{role?,active?,password?}`.

## Recognition (one process / one worker)

- POST `/recognition/sessions` `{mode:"ENTRY"|"EXIT"}` -> session.
- GET/DELETE `/recognition/sessions/{id}`; POST `/{id}/frames` multipart
  `frame` (JPEG/PNG), `sequence` (1,2,...); POST `/{id}/target` `{bbox:[x1,y1,x2,y2]}`.
- Session: `{id,mode,state:"COLLECTING"|"READY",status:"STABLE"|"UNCERTAIN",
  plateNumber,candidates:[{plateNumber,bbox,confidence}],needsTarget,sequence,expiresAt,stub}`.
  The pipeline reads only the largest detected plate in each frame, breaking equal-size ties
  by detector confidence. It returns at most one candidate; changing plates clears prior votes.
- POST `/{id}/confirm` `{plateNumber,reason?}` -> `{sourceEventId,plateNumber,expiresAt}`.
  Staff explicitly confirms. A correction requires a reason. Target changes invalidate confirmations.
- POST `/recognition/manual` `{plateNumber,mode,reason}` -> same confirmation DTO; audited.
- Export `verify_event(source_event_id, plate_number, actor_id, mode=None)` -> verified
  dict `{sourceEventId,plateNumber,actorId,mode,manual,reason,expiresAt}`;
  raises HTTPException for forged, expired, cross-user or changed-target events.

## Parking

- POST `/parking-sessions/check-in/precheck` `{sourceEventId,plateNumber,vehicleType}`
  -> `{sourceEventId,plateNumber,alerts:[],canCheckIn}`. Creates alerts durably even on cancellation.
- POST `/parking-sessions/check-in` same body + `Idempotency-Key` -> session.
  Requires a successful precheck for this observation, rechecks watchlist and review status atomically.
- GET `/parking-sessions?status=ACTIVE&plateNumber=...` -> paginated sessions.
- POST `/parking-sessions/{id}/fee-preview` -> `{sessionId,fee,durationMinutes,asOf}`.
- POST `/parking-sessions/{id}/check-out` `{sourceEventId,plateNumber,paymentMethod:"CASH"|"TRANSFER",
  paymentConfirmed:true,expectedFee,manualSelectionReason?}` + `Idempotency-Key` -> session.
  Different recognized plate requires manualSelectionReason. Error `409 FEE_CHANGED` leaves session active.
- Session: `{id,vehicleId,plateNumber,vehicleType,status,checkInAt,checkOutAt,fee,paymentMethod,pricingSnapshot}`.

## Administration and alerts

- GET/POST `/stolen-vehicles`, GET/PATCH `/stolen-vehicles/{id}`;
  `{plateNumber,description,status:"ACTIVE"|"INACTIVE"}`. Only Admin mutates.
- GET `/alerts?status=...`; POST `/alerts/{id}/review` `{status:"REVIEWED"|"FALSE_POSITIVE",note}`.
  Alert: `{id,sourceEventId,stolenVehicleId,plateNumber,status,note,createdAt}`.
- GET `/alerts/{id}/evidence` returns an authenticated JPEG crop if the confirmed
  observation had an image. Crops (at most 640×256) are stored transactionally in
  AlertEvent evidence; list responses expose only imagePath and metadata. Manual
  observations have no image. Evidence survives recognition cancellation/expiry.
- GET/POST `/pricing-policies`; GET `/pricing-policies/{id}`;
  create `{vehicleType,hourlyRate,roundingMinutes}` atomically activates an immutable new version.
- GET `/vehicles`, GET/PATCH `/vehicles/{id}`, GET `/vehicles/{id}/history`.
  Patch `{plateNumber?,vehicleType?}` forbidden while ACTIVE.
- GET `/audit-logs?actorId=&action=&entityType=&entityId=&dateFrom=&dateTo=&page=` Admin only.

Fee = ceiling minutes to policy interval, multiply rate / 60 using Decimal,
then round half up to whole VND. Elapsed partial minutes round upward. No minimum fee.
All idempotency records are scoped by actor, operation and key; a payload change is a 409.
