from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, JSON, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow


def identifier():
    return str(uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(10))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (CheckConstraint("role IN ('ADMIN','STAFF')"),)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    csrf_token: Mapped[str] = mapped_column(Text)


class Vehicle(Base):
    __tablename__ = "vehicles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    plate_number: Mapped[str] = mapped_column(String(20), unique=True)
    vehicle_type: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (CheckConstraint("vehicle_type IN ('CAR','MOTORBIKE')"),)


class PricingPolicy(Base):
    __tablename__ = "pricing_policies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    vehicle_type: Mapped[str] = mapped_column(String(10))
    version: Mapped[int]
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    rounding_minutes: Mapped[int]
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (
        CheckConstraint("vehicle_type IN ('CAR','MOTORBIKE')"),
        CheckConstraint("hourly_rate >= 0 AND rounding_minutes > 0 AND version > 0"),
        UniqueConstraint("vehicle_type", "version"),
        Index("one_active_policy_per_type", "vehicle_type", unique=True, postgresql_where=text("active")),
    )


class ParkingSession(Base):
    __tablename__ = "parking_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), index=True)
    plate_number: Mapped[str] = mapped_column(String(20))
    vehicle_type: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), default="ACTIVE")
    check_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    check_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pricing_policy_id: Mapped[str] = mapped_column(ForeignKey("pricing_policies.id"))
    pricing_snapshot: Mapped[dict] = mapped_column(JSON)
    fee: Mapped[Decimal | None] = mapped_column(Numeric(14, 0))
    payment_method: Mapped[str | None] = mapped_column(String(10))
    payment_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    check_in_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    check_out_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE','COMPLETED')"),
        CheckConstraint("vehicle_type IN ('CAR','MOTORBIKE')"),
        CheckConstraint("fee IS NULL OR fee >= 0"),
        CheckConstraint("payment_method IS NULL OR payment_method IN ('CASH','TRANSFER')"),
        CheckConstraint("check_out_at IS NULL OR check_out_at >= check_in_at"),
        CheckConstraint("(status = 'ACTIVE' AND check_out_at IS NULL AND fee IS NULL AND payment_method IS NULL "
                        "AND NOT payment_confirmed AND check_out_by IS NULL) OR "
                        "(status = 'COMPLETED' AND check_out_at IS NOT NULL AND fee IS NOT NULL "
                        "AND payment_method IS NOT NULL AND payment_confirmed AND check_out_by IS NOT NULL)"),
        Index("one_active_session_per_vehicle", "vehicle_id", unique=True, postgresql_where=text("status = 'ACTIVE'")),
    )


class StolenVehicle(Base):
    __tablename__ = "stolen_vehicles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    plate_number: Mapped[str] = mapped_column(String(20), unique=True)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (CheckConstraint("status IN ('ACTIVE','INACTIVE')"),)


class AlertEvent(Base):
    __tablename__ = "alert_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    source_event_id: Mapped[str] = mapped_column(Text)
    stolen_vehicle_id: Mapped[str] = mapped_column(ForeignKey("stolen_vehicles.id"))
    plate_number: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    decision: Mapped[str | None] = mapped_column(String(10), nullable=True)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (
        UniqueConstraint("source_event_id", "stolen_vehicle_id"),
        CheckConstraint("status IN ('PENDING','REVIEWED','FALSE_POSITIVE')"),
        CheckConstraint("status = 'PENDING' OR (note IS NOT NULL AND length(trim(note)) > 0)"),
        CheckConstraint("decision IS NULL OR decision IN ('ALLOW','BLOCK')", name="alert_decision_valid"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=identifier)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    operation: Mapped[str] = mapped_column(String(100))
    key: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("actor_id", "operation", "key"),)
