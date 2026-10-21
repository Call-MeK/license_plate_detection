"""Parking transactions, immutable fee snapshots and retry-safe payments."""
import hashlib
import json
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from math import ceil
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text

from app.auth import audit, csrf_protect, current_user
from app.database import get_db, utcnow
from app.models import IdempotencyRecord, ParkingSession, PricingPolicy, Vehicle
from src.postprocess import clean_plate, is_valid

router = APIRouter(prefix="/api/v1/parking-sessions", dependencies=[Depends(csrf_protect)])


def fail(status, code, message):
    raise HTTPException(status, detail={"code": code, "message": message})


def normalized_plate(value):
    plate = clean_plate(value)
    if not is_valid(plate):
        fail(422, "INVALID_PLATE", "Biển số không đúng định dạng hỗ trợ.")
    return plate


def lock(db, key):
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key})


def calculate_fee(duration_minutes: int, hourly_rate: Decimal, rounding_minutes: int) -> int:
    if (duration_minutes < 0 or rounding_minutes <= 0 or
            not hourly_rate.is_finite() or hourly_rate < 0):
        raise ValueError("Invalid duration or pricing policy")
    minutes = ((duration_minutes + rounding_minutes - 1) // rounding_minutes) * rounding_minutes
    return int((Decimal(minutes) * hourly_rate / 60).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def session_dict(item):
    return {"id": item.id, "vehicleId": item.vehicle_id, "plateNumber": item.plate_number,
            "vehicleType": item.vehicle_type, "status": item.status,
            "checkInAt": item.check_in_at.isoformat(),
            "checkOutAt": item.check_out_at.isoformat() if item.check_out_at else None,
            "fee": int(item.fee) if item.fee is not None else None,
            "paymentMethod": item.payment_method, "paymentConfirmed": item.payment_confirmed,
            "pricingSnapshot": item.pricing_snapshot}


def vehicle_dict(item):
    return {"id": item.id, "plateNumber": item.plate_number, "vehicleType": item.vehicle_type,
            "createdAt": item.created_at.isoformat()}


def page_result(db, statement, serializer, page, page_size):
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    items = db.scalars(statement.offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [serializer(item) for item in items], "total": total,
            "page": page, "pageSize": page_size}


class CheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceEventId: str = Field(min_length=1, max_length=2000)
    plateNumber: str = Field(min_length=1, max_length=32)
    vehicleType: Literal["CAR", "MOTORBIKE"]


class CheckOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceEventId: str = Field(min_length=1, max_length=2000)
    plateNumber: str = Field(min_length=1, max_length=32)
    paymentMethod: Literal["CASH", "TRANSFER"]
    paymentConfirmed: Literal[True]
    expectedFee: int = Field(ge=0, strict=True)
    manualSelectionReason: str | None = Field(default=None, max_length=1000)


def fingerprint(body):
    return hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def replay(db, actor, operation, key, digest):
    lock(db, f"idempotency:{actor}:{operation}:{key}")
    saved = db.scalar(select(IdempotencyRecord).where(
        IdempotencyRecord.actor_id == actor, IdempotencyRecord.operation == operation,
        IdempotencyRecord.key == key))
    if saved and saved.fingerprint != digest:
        fail(409, "IDEMPOTENCY_CONFLICT", "Khóa yêu cầu đã được dùng với nội dung khác.")
    return saved


def remember(db, actor, operation, key, digest, response):
    db.add(IdempotencyRecord(actor_id=actor, operation=operation, key=key,
                             fingerprint=digest, response=response))


@router.post("/check-in/precheck")
def precheck(body: CheckIn, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    from app.alerts import alert_dict, match_alerts
    from app.recognition import event_guard, verify_event
    with event_guard():
        plate = normalized_plate(body.plateNumber)
        event = verify_event(body.sourceEventId, plate, user.id, "ENTRY", db=db)
        digest = fingerprint(body)
        lock(db, f"idempotency:{user.id}:PRECHECK:{body.sourceEventId}")
        saved = db.scalar(select(IdempotencyRecord).where(
            IdempotencyRecord.actor_id == user.id, IdempotencyRecord.operation == "PRECHECK",
            IdempotencyRecord.key == body.sourceEventId))
        lock(db, "plate:" + plate)
        alerts = match_alerts(db, event, user.id)
        response = {"sourceEventId": body.sourceEventId, "plateNumber": plate,
                    "alerts": [alert_dict(item) for item in alerts],
                    "canCheckIn": all(item.status != "PENDING" and item.decision == "ALLOW" for item in alerts)}
        if saved:
            saved.fingerprint = digest
            saved.response = response
        else:
            remember(db, user.id, "PRECHECK", body.sourceEventId, digest, response)
        db.commit()
        return response


@router.post("/check-in")
def check_in(body: CheckIn, idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=200),
             db=Depends(get_db, scope="function"), user=Depends(current_user)):
    from app.alerts import match_alerts
    from app.recognition import event_guard, verify_event
    with event_guard():
        digest = fingerprint(body)
        saved = replay(db, user.id, "CHECK_IN", idempotency_key, digest)
        if saved:
            return saved.response
        plate = normalized_plate(body.plateNumber)
        lock(db, f"event:{body.sourceEventId}")
        event = verify_event(body.sourceEventId, plate, user.id, "ENTRY", db=db)
        checked = db.scalar(select(IdempotencyRecord).where(
            IdempotencyRecord.actor_id == user.id, IdempotencyRecord.operation == "PRECHECK",
            IdempotencyRecord.key == body.sourceEventId))
        if not checked or checked.fingerprint != digest:
            fail(409, "PRECHECK_REQUIRED", "Cần kiểm tra cảnh báo cho đúng biển số trước khi cho xe vào.")
        lock(db, "plate:" + plate)
        alerts = match_alerts(db, event, user.id)
        if any(item.status == "PENDING" for item in alerts):
            # Alert history survives a rejected or cancelled parking operation.
            db.commit()
            fail(409, "ALERT_REVIEW_REQUIRED", "Cần xử lý cảnh báo trước khi cho xe vào.")
        if any(item.decision == "BLOCK" or item.decision != "ALLOW" for item in alerts):
            db.commit()
            fail(409, "ALERT_BLOCKED", "Phương tiện bị chặn theo quyết định xử lý cảnh báo.")
        vehicle = db.scalar(select(Vehicle).where(Vehicle.plate_number == plate).with_for_update())
        if vehicle:
            active = db.scalar(select(ParkingSession.id).where(
                ParkingSession.vehicle_id == vehicle.id, ParkingSession.status == "ACTIVE"))
            if active:
                fail(409, "ALREADY_PARKED", "Xe đang có lượt gửi chưa kết thúc.")
            if vehicle.vehicle_type != body.vehicleType:
                fail(409, "VEHICLE_TYPE_CONFLICT", "Loại xe khác hồ sơ; cần Admin kiểm tra.")
        policy = db.scalar(select(PricingPolicy).where(
            PricingPolicy.vehicle_type == body.vehicleType, PricingPolicy.active.is_(True)))
        if not policy:
            fail(409, "PRICING_REQUIRED", "Chưa có chính sách giá cho loại xe này.")
        if not vehicle:
            vehicle = Vehicle(plate_number=plate, vehicle_type=body.vehicleType)
            db.add(vehicle)
            db.flush()
        item = ParkingSession(vehicle_id=vehicle.id, plate_number=plate, vehicle_type=body.vehicleType,
                              status="ACTIVE", check_in_by=user.id, pricing_policy_id=policy.id,
                              pricing_snapshot={"hourlyRate": str(policy.hourly_rate),
                                                "roundingMinutes": policy.rounding_minutes,
                                                "version": policy.version})
        db.add(item)
        db.flush()
        result = session_dict(item)
        audit(db, user.id, "PARKING_CHECK_IN", "ParkingSession", item.id,
              {"plateNumber": plate, "sourceEventId": body.sourceEventId})
        remember(db, user.id, "EVENT_CONSUMED", body.sourceEventId, digest,
                 {"operation": "CHECK_IN", "sessionId": item.id})
        remember(db, user.id, "CHECK_IN", idempotency_key, digest, result)
        db.commit()
        return result


@router.get("")
def list_sessions(status: Literal["ACTIVE", "COMPLETED"] | None = None, plateNumber: str = "",
                  page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                  db=Depends(get_db, scope="function"), user=Depends(current_user)):
    statement = select(ParkingSession).order_by(ParkingSession.check_in_at.desc(), ParkingSession.id)
    if status:
        statement = statement.where(ParkingSession.status == status)
    if plateNumber:
        statement = statement.where(ParkingSession.plate_number.contains(clean_plate(plateNumber)))
    return page_result(db, statement, session_dict, page, pageSize)


def fee_preview(item):
    now = utcnow()
    duration = max(0, ceil((now - item.check_in_at).total_seconds() / 60))
    policy = item.pricing_snapshot
    return {"sessionId": item.id, "fee": calculate_fee(duration, Decimal(policy["hourlyRate"]),
                                                       policy["roundingMinutes"]),
            "durationMinutes": duration, "asOf": now.isoformat()}


@router.post("/{session_id}/fee-preview")
def preview_fee(session_id: str, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    item = db.get(ParkingSession, session_id)
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy lượt gửi xe.")
    if item.status != "ACTIVE":
        fail(409, "NOT_ACTIVE", "Lượt gửi đã kết thúc.")
    return fee_preview(item)


@router.post("/{session_id}/check-out")
def check_out(session_id: str, body: CheckOut,
              idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=200),
              db=Depends(get_db, scope="function"), user=Depends(current_user)):
    from app.recognition import event_guard, verify_event
    with event_guard():
        digest = fingerprint(body)
        operation = "CHECK_OUT:" + session_id
        saved = replay(db, user.id, operation, idempotency_key, digest)
        if saved:
            return saved.response
        plate = normalized_plate(body.plateNumber)
        lock(db, f"event:{body.sourceEventId}")
        verify_event(body.sourceEventId, plate, user.id, "EXIT", db=db)
        item = db.scalar(select(ParkingSession).where(ParkingSession.id == session_id).with_for_update())
        if not item:
            fail(404, "NOT_FOUND", "Không tìm thấy lượt gửi xe.")
        if item.status != "ACTIVE":
            fail(409, "NOT_ACTIVE", "Lượt gửi đã kết thúc.")
        reason = (body.manualSelectionReason or "").strip()
        if item.plate_number != plate and not reason:
            fail(422, "SELECTION_REASON_REQUIRED", "Cần lý do khi chọn lượt gửi khác biển số xác nhận.")
        preview = fee_preview(item)
        if body.expectedFee != preview["fee"]:
            fail(409, "FEE_CHANGED", "Phí đã thay đổi. Xem lại phí và xác nhận thu tiền.")
        item.check_out_at = datetime.fromisoformat(preview["asOf"])
        item.status = "COMPLETED"
        item.fee = preview["fee"]
        item.payment_method = body.paymentMethod
        item.payment_confirmed = True
        item.check_out_by = user.id
        db.flush()
        result = session_dict(item)
        audit(db, user.id, "PARKING_CHECK_OUT", "ParkingSession", item.id,
              {"plateNumber": plate, "sourceEventId": body.sourceEventId,
               "manualSelectionReason": reason or None, "fee": preview["fee"], "paymentMethod": body.paymentMethod})
        remember(db, user.id, "EVENT_CONSUMED", body.sourceEventId, digest,
                 {"operation": "CHECK_OUT", "sessionId": item.id})
        remember(db, user.id, operation, idempotency_key, digest, result)
        db.commit()
        return result
