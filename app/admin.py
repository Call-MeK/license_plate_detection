"""Minimal pricing, vehicle history and Admin-only audit queries."""
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.auth import admin_user, audit, csrf_protect, current_user
from app.database import get_db
from app.models import AuditLog, ParkingSession, PricingPolicy, Vehicle
from app.parking import fail, lock, normalized_plate, page_result, session_dict, vehicle_dict

router = APIRouter(prefix="/api/v1", dependencies=[Depends(csrf_protect)])


class PolicyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicleType: Literal["CAR", "MOTORBIKE"]
    hourlyRate: Decimal = Field(ge=0, le=1_000_000_000, decimal_places=2, allow_inf_nan=False)
    roundingMinutes: int = Field(ge=1, le=1440, strict=True)


class VehiclePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plateNumber: str | None = Field(default=None, min_length=1, max_length=32)
    vehicleType: Literal["CAR", "MOTORBIKE"] | None = None


def policy_dict(item):
    return {"id": item.id, "vehicleType": item.vehicle_type, "version": item.version,
            "hourlyRate": str(item.hourly_rate), "roundingMinutes": item.rounding_minutes,
            "active": item.active, "createdAt": item.created_at.isoformat()}


@router.get("/pricing-policies")
def list_policies(page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                  db=Depends(get_db, scope="function"), user=Depends(current_user)):
    return page_result(db, select(PricingPolicy).order_by(PricingPolicy.created_at.desc(), PricingPolicy.id),
                       policy_dict, page, pageSize)


@router.post("/pricing-policies")
def create_policy(body: PolicyInput, db=Depends(get_db, scope="function"), user=Depends(admin_user)):
    lock(db, "policy:" + body.vehicleType)
    current = db.scalar(select(PricingPolicy).where(
        PricingPolicy.vehicle_type == body.vehicleType, PricingPolicy.active.is_(True)).with_for_update())
    version = (db.scalar(select(func.max(PricingPolicy.version)).where(
        PricingPolicy.vehicle_type == body.vehicleType)) or 0) + 1
    if current:
        current.active = False
        db.flush()
    item = PricingPolicy(vehicle_type=body.vehicleType, version=version, hourly_rate=body.hourlyRate,
                         rounding_minutes=body.roundingMinutes, active=True)
    db.add(item)
    db.flush()
    audit(db, user.id, "PRICING_CREATED", "PricingPolicy", item.id, policy_dict(item))
    return policy_dict(item)


@router.get("/pricing-policies/{policy_id}")
def get_policy(policy_id: str, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    item = db.get(PricingPolicy, policy_id)
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy chính sách giá.")
    return policy_dict(item)


@router.get("/vehicles")
def list_vehicles(plateNumber: str = "", page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                  db=Depends(get_db, scope="function"), user=Depends(current_user)):
    from src.postprocess import clean_plate
    statement = select(Vehicle).order_by(Vehicle.created_at.desc(), Vehicle.id)
    if plateNumber:
        statement = statement.where(Vehicle.plate_number.contains(clean_plate(plateNumber)))
    return page_result(db, statement, vehicle_dict, page, pageSize)


@router.get("/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: str, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    item = db.get(Vehicle, vehicle_id)
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy xe.")
    return vehicle_dict(item)


@router.get("/vehicles/{vehicle_id}/history")
def vehicle_history(vehicle_id: str, page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                     db=Depends(get_db, scope="function"), user=Depends(current_user)):
    if not db.get(Vehicle, vehicle_id):
        fail(404, "NOT_FOUND", "Không tìm thấy xe.")
    statement = select(ParkingSession).where(ParkingSession.vehicle_id == vehicle_id).order_by(
        ParkingSession.check_in_at.desc(), ParkingSession.id)
    return page_result(db, statement, session_dict, page, pageSize)


@router.patch("/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: str, body: VehiclePatch, db=Depends(get_db, scope="function"), user=Depends(admin_user)):
    lock(db, "vehicle:" + vehicle_id)
    item = db.get(Vehicle, vehicle_id)
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy xe.")
    plate = normalized_plate(body.plateNumber) if body.plateNumber is not None else item.plate_number
    for number in sorted({plate, item.plate_number}):
        lock(db, "plate:" + number)
    # Refresh after locks: another check-in may have committed while we waited.
    db.refresh(item, with_for_update=True)
    if db.scalar(select(ParkingSession.id).where(
            ParkingSession.vehicle_id == vehicle_id, ParkingSession.status == "ACTIVE")):
        fail(409, "ACTIVE_VEHICLE", "Không sửa hồ sơ xe đang trong bãi.")
    if db.scalar(select(Vehicle.id).where(Vehicle.plate_number == plate, Vehicle.id != item.id)):
        fail(409, "PLATE_EXISTS", "Biển số thuộc hồ sơ khác.")
    before = vehicle_dict(item)
    item.plate_number = plate
    if body.vehicleType is not None:
        item.vehicle_type = body.vehicleType
    audit(db, user.id, "VEHICLE_UPDATED", "Vehicle", item.id, {"before": before, "after": vehicle_dict(item)})
    return vehicle_dict(item)


def audit_dict(item):
    return {"id": item.id, "actorId": item.actor_id, "action": item.action,
            "entityType": item.entity_type, "entityId": item.entity_id,
            "details": item.details, "createdAt": item.created_at.isoformat()}


@router.get("/audit-logs")
def list_audit(actorId: str | None = None, action: str | None = None, entityType: str | None = None,
               entityId: str | None = None, dateFrom: datetime | None = None, dateTo: datetime | None = None,
               page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
               db=Depends(get_db, scope="function"), user=Depends(admin_user)):
    if any(value is not None and value.tzinfo is None for value in (dateFrom, dateTo)):
        fail(422, "TIMEZONE_REQUIRED", "Thời điểm lọc cần có múi giờ.")
    if dateFrom and dateTo and dateFrom > dateTo:
        fail(422, "INVALID_DATE_RANGE", "Khoảng thời gian không hợp lệ.")
    statement = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id)
    for column, value in ((AuditLog.actor_id, actorId), (AuditLog.action, action),
                           (AuditLog.entity_type, entityType), (AuditLog.entity_id, entityId)):
        if value is not None:
            statement = statement.where(column == value)
    if dateFrom:
        statement = statement.where(AuditLog.created_at >= dateFrom)
    if dateTo:
        statement = statement.where(AuditLog.created_at <= dateTo)
    return page_result(db, statement, audit_dict, page, pageSize)
