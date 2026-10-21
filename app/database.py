"""PostgreSQL sessions and repeatable initial schema creation.

Run ``python -m app.database init`` and ``python -m app.database seed-admin``.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, sessionmaker


load_dotenv()


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


try:
    engine = create_engine(os.getenv("DATABASE_URL", "postgresql+psycopg://localhost/parking"),
                           pool_pre_ping=True, pool_timeout=5, hide_parameters=True,
                           connect_args={"connect_timeout": 3})
    if engine.dialect.name != "postgresql":
        raise ValueError
except (SQLAlchemyError, ValueError, TypeError):
    raise RuntimeError("Invalid DATABASE_URL; configure a PostgreSQL psycopg URL") from None
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def database_error(exc):
    if getattr(getattr(exc, "orig", None), "sqlstate", None) in {"42P01", "42703"}:
        return {"code": "DATABASE_SCHEMA_REQUIRED", "message": "Database schema is missing or outdated; run init for a new database or migrate for an existing one"}
    return {"code": "DATABASE_UNAVAILABLE", "message": "PostgreSQL is unavailable; check DATABASE_URL, service and permissions"}


def get_db():
    with SessionLocal.begin() as db:
        yield db


def check_db():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def migrate_db():
    """Add decision without rewriting historical reviews or assuming ALLOW."""
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        connection.execute(text("ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS decision VARCHAR(10)"))
        constraints = inspect(connection).get_check_constraints("alert_events")
        if not any(c["name"] == "alert_decision_valid" for c in constraints):
            # NOT VALID preserves even malformed legacy values; new writes are checked.
            connection.execute(text("ALTER TABLE alert_events ADD CONSTRAINT alert_decision_valid "
                                    "CHECK (decision IS NULL OR decision IN ('ALLOW','BLOCK')) NOT VALID"))
        invalid = connection.scalar(text("SELECT count(*) FROM alert_events "
                                         "WHERE decision IS NOT NULL AND decision NOT IN ('ALLOW','BLOCK')"))
        if not invalid:
            connection.execute(text("ALTER TABLE alert_events VALIDATE CONSTRAINT alert_decision_valid"))
        return connection.scalar(text("SELECT count(*) FROM alert_events WHERE status <> 'PENDING' "
                                      "AND (decision IS NULL OR decision NOT IN ('ALLOW','BLOCK'))"))


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
    parser.add_argument("command", choices=["check", "migrate", "init", "seed-admin", "seed-demo"])
    parser.add_argument("--expect-database", help="Required for migrate; must match the configured database name")
    args = parser.parse_args()
    if args.expect_database and args.expect_database != engine.url.database:
        parser.error("Configured database differs from --expect-database; no changes made")
    if args.command == "check":
        check_db()
        print(f"PostgreSQL SELECT 1 OK: host={engine.url.host}, port={engine.url.port or 5432}, database={engine.url.database}")
        return
    if args.command == "migrate":
        if not args.expect_database:
            parser.error("Run check first, then migrate --expect-database <verified database name>")
        unresolved = migrate_db()
        print(f"Decision migration applied; {unresolved} historical reviews without a valid decision remain blocked. See docs/database-setup.md.")
        return
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
    from app.database import cli as run_cli, database_error as safe_error
    try:
        run_cli()
    except SQLAlchemyError as exc:
        raise SystemExit(safe_error(exc)["message"]) from None
