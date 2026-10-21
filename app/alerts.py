"""Watchlist dossiers and persistent, reviewed observation alerts."""
import base64
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.auth import admin_user, audit, csrf_protect, current_user
from app.database import get_db, utcnow
from app.models import AlertEvent, StolenVehicle
from app.parking import fail, lock, normalized_plate, page_result

router = APIRouter(prefix="/api/v1", dependencies=[Depends(csrf_protect)])


def dossier_dict(item):
    return {"id": item.id, "plateNumber": item.plate_number, "description": item.description,
            "status": item.status, "createdAt": item.created_at.isoformat()}


def alert_dict(item):
    return {"id": item.id, "sourceEventId": item.source_event_id,
            "stolenVehicleId": item.stolen_vehicle_id, "plateNumber": item.plate_number,
            "status": item.status, "decision": item.decision, "note": item.note,
            "createdAt": item.created_at.isoformat(),
            "reviewedAt": item.reviewed_at.isoformat() if item.reviewed_at else None,
            "reviewedBy": item.reviewed_by,
            "evidence": {key: value for key, value in item.evidence.items() if key != "imageBase64"}}


def match_alerts(db, event, actor_id):
    """Caller holds the plate advisory lock through commit."""
    existing = db.scalars(select(AlertEvent).where(AlertEvent.source_event_id == event["sourceEventId"])).all()
    known = {item.stolen_vehicle_id for item in existing}
    dossiers = db.scalars(select(StolenVehicle).where(
        StolenVehicle.plate_number == event["plateNumber"], StolenVehicle.status == "ACTIVE")).all()
    for dossier in dossiers:
        if dossier.id not in known:
            item = AlertEvent(source_event_id=event["sourceEventId"], stolen_vehicle_id=dossier.id,
                              plate_number=event["plateNumber"], status="PENDING",
                              evidence={"description": dossier.description, "mode": event["mode"],
                                        "manual": event["manual"], "reason": event.get("reason"),
                                        "bbox": event.get("bbox"), "confidence": event.get("confidence"),
                                        "imageBase64": event.get("imageBase64"),
                                        "imagePath": None})
            db.add(item)
            db.flush()
            if event.get("imageBase64"):
                item.evidence = {**item.evidence, "imagePath": f"/api/v1/alerts/{item.id}/evidence"}
            audit(db, actor_id, "ALERT_CREATED", "AlertEvent", item.id,
                  {"plateNumber": item.plate_number, "sourceEventId": item.source_event_id})
            existing.append(item)
    return existing


class Dossier(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plateNumber: str = Field(min_length=1, max_length=32)
    description: str = Field(min_length=1, max_length=4000)
    status: Literal["ACTIVE", "INACTIVE"] = "ACTIVE"

    @field_validator("description")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Description must not be blank")
        return value.strip()


class DossierPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plateNumber: str | None = Field(default=None, min_length=1, max_length=32)
    description: str | None = Field(default=None, min_length=1, max_length=4000)
    status: Literal["ACTIVE", "INACTIVE"] | None = None


class Review(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["REVIEWED", "FALSE_POSITIVE"]
    decision: Literal["ALLOW", "BLOCK"] | None = None
    note: str = Field(min_length=1, max_length=4000)

    @field_validator("note")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("A review note is required")
        return value.strip()


@router.get("/stolen-vehicles")
def list_watchlist(status: Literal["ACTIVE", "INACTIVE"] | None = None,
                  page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                  db=Depends(get_db, scope="function"), user=Depends(current_user)):
    statement = select(StolenVehicle).order_by(StolenVehicle.created_at.desc(), StolenVehicle.id)
    if status:
        statement = statement.where(StolenVehicle.status == status)
    return page_result(db, statement, dossier_dict, page, pageSize)


@router.post("/stolen-vehicles")
def create_watchlist(body: Dossier, db=Depends(get_db, scope="function"), user=Depends(admin_user)):
    plate = normalized_plate(body.plateNumber)
    lock(db, "plate:" + plate)
    if db.scalar(select(StolenVehicle.id).where(StolenVehicle.plate_number == plate)):
        fail(409, "WATCHLIST_EXISTS", "Biển số đã có hồ sơ cảnh báo.")
    item = StolenVehicle(plate_number=plate, description=body.description, status=body.status)
    db.add(item)
    db.flush()
    audit(db, user.id, "WATCHLIST_CREATED", "StolenVehicle", item.id, dossier_dict(item))
    return dossier_dict(item)


@router.get("/stolen-vehicles/{dossier_id}")
def get_watchlist(dossier_id: str, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    item = db.get(StolenVehicle, dossier_id)
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy hồ sơ.")
    return dossier_dict(item)


@router.patch("/stolen-vehicles/{dossier_id}")
def update_watchlist(dossier_id: str, body: DossierPatch, db=Depends(get_db, scope="function"), user=Depends(admin_user)):
    # Serialize dossier edits before choosing plate locks; check-in never locks a dossier row.
    item = db.scalar(select(StolenVehicle).where(StolenVehicle.id == dossier_id).with_for_update())
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy hồ sơ.")
    plate = normalized_plate(body.plateNumber) if body.plateNumber is not None else item.plate_number
    for number in sorted({item.plate_number, plate}):
        lock(db, "plate:" + number)
    if db.scalar(select(StolenVehicle.id).where(StolenVehicle.plate_number == plate, StolenVehicle.id != item.id)):
        fail(409, "WATCHLIST_EXISTS", "Biển số đã có hồ sơ khác.")
    if body.description is not None:
        if not body.description.strip():
            fail(422, "DESCRIPTION_REQUIRED", "Cần mô tả hồ sơ.")
        item.description = body.description.strip()
    item.plate_number = plate
    if body.status is not None:
        item.status = body.status
    audit(db, user.id, "WATCHLIST_UPDATED", "StolenVehicle", item.id, dossier_dict(item))
    return dossier_dict(item)


@router.get("/alerts")
def list_alerts(status: Literal["PENDING", "REVIEWED", "FALSE_POSITIVE"] | None = None,
                page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
                db=Depends(get_db, scope="function"), user=Depends(current_user)):
    statement = select(AlertEvent).order_by(AlertEvent.created_at.desc(), AlertEvent.id)
    if status:
        statement = statement.where(AlertEvent.status == status)
    return page_result(db, statement, alert_dict, page, pageSize)


@router.get("/alerts/{alert_id}/evidence")
def alert_evidence(alert_id: str, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    item = db.get(AlertEvent, alert_id)
    if not item or not item.evidence.get("imageBase64"):
        fail(404, "NO_EVIDENCE", "Cảnh báo không có ảnh bằng chứng.")
    return Response(base64.b64decode(item.evidence["imageBase64"], validate=True), media_type="image/jpeg",
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/alerts/{alert_id}/review")
def review_alert(alert_id: str, body: Review, db=Depends(get_db, scope="function"), user=Depends(current_user)):
    item = db.scalar(select(AlertEvent).where(AlertEvent.id == alert_id).with_for_update())
    if not item:
        fail(404, "NOT_FOUND", "Không tìm thấy cảnh báo.")
    if item.status != "PENDING":
        fail(409, "ALREADY_REVIEWED", "Cảnh báo đã được xử lý; không ghi đè lịch sử.")
    if body.status == "FALSE_POSITIVE":
        decision = body.decision or "ALLOW"
        if decision != "ALLOW":
            fail(422, "INVALID_DECISION", "Cảnh báo nhầm chỉ có thể có quyết định cho phép vào (ALLOW).")
    elif body.status == "REVIEWED":
        if not body.decision:
            fail(422, "DECISION_REQUIRED", "Cần chọn quyết định cho phép (ALLOW) hoặc chặn (BLOCK).")
        decision = body.decision
    else:
        fail(422, "INVALID_STATUS", "Trạng thái xử lý không hợp lệ.")
    item.status = body.status
    item.decision = decision
    item.note = body.note
    item.reviewed_at, item.reviewed_by = utcnow(), user.id
    audit(db, user.id, "ALERT_REVIEWED", "AlertEvent", item.id,
          {"status": body.status, "decision": decision, "note": body.note})
    return alert_dict(item)
