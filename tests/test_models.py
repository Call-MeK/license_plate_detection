from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, DBAPIError


def test_schema_contains_exactly_nine_tables(db):
    from app.database import Base
    assert len(Base.metadata.tables) == 9


def test_vehicle_plate_unique(db):
    from app.models import Vehicle
    db.add_all([Vehicle(plate_number="51F12345", vehicle_type="CAR"),
                Vehicle(plate_number="51F12345", vehicle_type="CAR")])
    with pytest.raises(IntegrityError):
        db.flush()


def test_only_one_active_parking_session(db, staff):
    from app.models import ParkingSession, PricingPolicy, Vehicle
    vehicle = Vehicle(plate_number="51F12345", vehicle_type="CAR")
    policy = PricingPolicy(vehicle_type="CAR", version=1, hourly_rate=Decimal("5000"), rounding_minutes=30)
    db.add_all([vehicle, policy])
    db.flush()
    for _ in range(2):
        db.add(ParkingSession(vehicle_id=vehicle.id, plate_number=vehicle.plate_number,
                             vehicle_type="CAR", pricing_policy_id=policy.id,
                             pricing_snapshot={"hourlyRate": "5000", "roundingMinutes": 30, "version": 1},
                             check_in_by=staff.id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_idempotency_key_scoped_to_actor_and_operation(db, staff):
    from app.models import IdempotencyRecord
    for fingerprint in ("first", "changed"):
        db.add(IdempotencyRecord(actor_id=staff.id, operation="check-in", key="retry", fingerprint=fingerprint, response={}))
    with pytest.raises(IntegrityError):
        db.flush()


def test_alert_source_watchlist_pair_unique(db):
    from app.models import AlertEvent, StolenVehicle
    watch = StolenVehicle(plate_number="51F12345", description="Test watchlist")
    db.add(watch)
    db.flush()
    for _ in range(2):
        db.add(AlertEvent(source_event_id="confirmed-observation", stolen_vehicle_id=watch.id,
                          plate_number=watch.plate_number, evidence={}))
    with pytest.raises(IntegrityError):
        db.flush()


def test_reviewed_alert_requires_note(db):
    from app.models import AlertEvent, StolenVehicle
    watch = StolenVehicle(plate_number="51F12345", description="Test watchlist")
    db.add(watch)
    db.flush()
    db.add(AlertEvent(source_event_id="event", stolen_vehicle_id=watch.id,
                      plate_number=watch.plate_number, status="REVIEWED", note=None, evidence={}))
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("field,value", [("hourly_rate", -1), ("rounding_minutes", 0), ("vehicle_type", "TRUCK")])
def test_invalid_policy_rejected(db, field, value):
    from app.models import PricingPolicy
    values = dict(vehicle_type="CAR", version=1, hourly_rate=5000, rounding_minutes=30)
    values[field] = value
    db.add(PricingPolicy(**values))
    with pytest.raises(IntegrityError):
        db.flush()


def test_audit_append_only_and_policy_economics_immutable(db, staff):
    from app.models import AuditLog, PricingPolicy
    policy = PricingPolicy(vehicle_type="CAR", version=1, hourly_rate=5000, rounding_minutes=30)
    log = AuditLog(actor_id=staff.id, action="TEST", entity_type="User", entity_id=staff.id, details={})
    db.add_all([policy, log])
    db.flush()
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("UPDATE audit_logs SET action='CHANGED' WHERE id=:id"), {"id": log.id})
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("DELETE FROM audit_logs WHERE id=:id"), {"id": log.id})
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text("UPDATE pricing_policies SET hourly_rate=1 WHERE id=:id"), {"id": policy.id})
    policy.active = False
    db.flush()


@pytest.mark.parametrize("field,value", [("check_out_at", None), ("fee", None), ("payment_method", None),
                                         ("payment_confirmed", False), ("check_out_by", None)])
def test_completed_session_requires_payment_record(db, staff, field, value):
    from app.database import utcnow
    from app.models import ParkingSession, PricingPolicy, Vehicle
    vehicle = Vehicle(plate_number="51F12345", vehicle_type="CAR")
    policy = PricingPolicy(vehicle_type="CAR", version=1, hourly_rate=5000, rounding_minutes=30)
    db.add_all([vehicle, policy])
    db.flush()
    values = dict(vehicle_id=vehicle.id, plate_number=vehicle.plate_number, vehicle_type="CAR",
                  status="COMPLETED", check_in_at=utcnow() - timedelta(minutes=1), check_out_at=utcnow(),
                  pricing_policy_id=policy.id, pricing_snapshot={"hourlyRate": "5000", "roundingMinutes": 30, "version": 1},
                  fee=2500, payment_method="CASH", payment_confirmed=True, check_in_by=staff.id, check_out_by=staff.id)
    values[field] = value
    db.add(ParkingSession(**values))
    with pytest.raises(IntegrityError):
        db.flush()


def test_active_session_cannot_have_completed_payment(db, staff):
    from app.models import ParkingSession, PricingPolicy, Vehicle
    vehicle = Vehicle(plate_number="51F12345", vehicle_type="CAR")
    policy = PricingPolicy(vehicle_type="CAR", version=1, hourly_rate=5000, rounding_minutes=30)
    db.add_all([vehicle, policy])
    db.flush()
    db.add(ParkingSession(vehicle_id=vehicle.id, plate_number=vehicle.plate_number, vehicle_type="CAR",
                          pricing_policy_id=policy.id, pricing_snapshot={}, check_in_by=staff.id,
                          payment_confirmed=True))
    with pytest.raises(IntegrityError):
        db.flush()
