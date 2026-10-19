"""PostgreSQL sessions and repeatable initial schema creation.

Run ``python -m app.database init`` and ``python -m app.database seed-admin``.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


load_dotenv()


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


engine = create_engine(os.getenv("DATABASE_URL", "postgresql+psycopg://localhost/parking"), pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with SessionLocal.begin() as db:
        yield db


def init_db():
    from app import models  # noqa: F401
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE OR REPLACE FUNCTION reject_audit_change() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'Audit logs are append-only'; END;
            $$ LANGUAGE plpgsql;
            DROP TRIGGER IF EXISTS audit_append_only ON audit_logs;
            CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION reject_audit_change();
            CREATE OR REPLACE FUNCTION reject_policy_change() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Pricing policy versions are immutable';
                END IF;
                IF (NEW.id, NEW.vehicle_type, NEW.version, NEW.hourly_rate, NEW.rounding_minutes, NEW.created_at)
                    IS DISTINCT FROM
                    (OLD.id, OLD.vehicle_type, OLD.version, OLD.hourly_rate, OLD.rounding_minutes, OLD.created_at) THEN
                    RAISE EXCEPTION 'Pricing policy economics are immutable';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            DROP TRIGGER IF EXISTS policy_immutable ON pricing_policies;
            CREATE TRIGGER policy_immutable BEFORE UPDATE OR DELETE ON pricing_policies
            FOR EACH ROW EXECUTE FUNCTION reject_policy_change();
        """))


def seed_demo(db):
    """Add fictional demo records without replacing user data or credentials."""
    from sqlalchemy import func, select
    from app.auth import audit
    from app.models import PricingPolicy, StolenVehicle
    data = json.loads((Path(__file__).resolve().parents[1] / "data" / "demo.json").read_text(encoding="utf-8"))
    for values in data["pricingPolicies"]:
        kind = values["vehicleType"]
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": "policy:" + kind})
        if not db.scalar(select(PricingPolicy.id).where(PricingPolicy.vehicle_type == kind, PricingPolicy.active.is_(True))):
            version = (db.scalar(select(func.max(PricingPolicy.version)).where(PricingPolicy.vehicle_type == kind)) or 0) + 1
            db.add(PricingPolicy(vehicle_type=kind, version=version,
                                 hourly_rate=values["hourlyRate"], rounding_minutes=values["roundingMinutes"]))
    for values in data["watchlist"]:
        plate = values["plateNumber"]
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": "plate:" + plate})
        if not db.scalar(select(StolenVehicle.id).where(StolenVehicle.plate_number == plate)):
            db.add(StolenVehicle(plate_number=plate, description=values["description"], status="ACTIVE"))
    audit(db, None, "DEMO_SEEDED", "Demo", "local-fixtures")


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "seed-admin", "seed-demo"])
    args = parser.parse_args()
    if args.command == "init":
        init_db()
        print("PostgreSQL schema initialized (9 tables).")
        return
    if args.command == "seed-demo":
        with SessionLocal.begin() as db:
            seed_demo(db)
        print("Fictional demo pricing/watchlist added; existing values retained.")
        return
    from app.auth import hash_password
    from app.models import User
    from sqlalchemy import select
    username = os.getenv("ADMIN_USERNAME", "").strip()
    password = os.getenv("ADMIN_PASSWORD", "")
    if not username or len(password) < 12:
        parser.error("Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters); no default credentials exist")
    with SessionLocal.begin() as db:
        if db.scalar(select(User).where(User.username == username)):
            parser.error("Username already exists; seed does not overwrite credentials")
        db.add(User(username=username, password_hash=hash_password(password), role="ADMIN"))
    print("Admin created.")


if __name__ == "__main__":
    # Keep model metadata bound to the same Base under module execution.
    from app.database import cli as run_cli
    run_cli()
