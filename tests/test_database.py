"""Rehearse additive migration only inside the isolated parking_test schema."""
import sys

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError


def test_migration_is_repeatable_on_fresh_schema(db):
    from app import database
    database.migrate_db()
    database.migrate_db()
    assert len(inspect(db.get_bind()).get_table_names()) == 9
    assert "decision" in {c["name"] for c in inspect(db.get_bind()).get_columns("alert_events")}


def test_migration_preserves_old_alert_history_and_fails_closed(db, staff_client, admin_client):
    from app import database
    from test_parking_checkin import check_in, policy, prepare
    policy(admin_client)
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Fictional legacy migration dossier"})
    body, precheck = prepare(staff_client)
    alert_id = precheck["alerts"][0]["id"]
    db.execute(text("UPDATE alert_events SET status='REVIEWED', note='Legacy note' WHERE id=:id"), {"id": alert_id})
    # Recreate the old schema before decision was introduced; only test data is touched.
    db.execute(text("ALTER TABLE alert_events DROP COLUMN decision"))
    db.commit()
    database.migrate_db()
    database.migrate_db()
    row = db.execute(text("SELECT status, note, decision FROM alert_events WHERE id=:id"), {"id": alert_id}).one()
    assert tuple(row) == ("REVIEWED", "Legacy note", None)
    db.commit()
    assert staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).json()["canCheckIn"] is False
    assert check_in(staff_client, body).json()["error"]["code"] == "ALERT_BLOCKED"
    assert staff_client.post(f"/api/v1/alerts/{alert_id}/review", json={
        "status": "REVIEWED", "decision": "ALLOW", "note": "Cannot overwrite history"}).status_code == 409
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("UPDATE alert_events SET decision='UNKNOWN' WHERE id=:id"), {"id": alert_id})


def test_admin_bootstrap_uses_postgres_and_never_overwrites(db, monkeypatch, capsys):
    from app import database
    from app.auth import password_matches
    from app.models import User
    from sqlalchemy import select
    monkeypatch.setattr(sys, "argv", ["database", "seed-admin"])
    monkeypatch.setenv("ADMIN_USERNAME", "bootstrap-admin")
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    with pytest.raises(SystemExit):
        database.cli()
    password = "EphemeralTestPassword123!"
    monkeypatch.setenv("ADMIN_PASSWORD", password)
    database.cli()
    user = db.scalar(select(User).where(User.username == "bootstrap-admin"))
    assert user.role == "ADMIN"
    assert user.password_hash.startswith("$argon2id$")
    assert password_matches(user.password_hash, password)
    with pytest.raises(SystemExit):
        database.cli()
    output = capsys.readouterr()
    assert password not in output.out + output.err


def test_migration_preserves_malformed_decision_but_rejects_new_invalid_writes(db, staff_client, admin_client):
    from app import database
    from test_parking_checkin import check_in, policy, prepare
    policy(admin_client)
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Fictional malformed legacy review"})
    body, precheck = prepare(staff_client)
    alert_id = precheck["alerts"][0]["id"]
    db.execute(text("ALTER TABLE alert_events DROP CONSTRAINT alert_decision_valid"))
    db.execute(text("UPDATE alert_events SET status='REVIEWED', note='Legacy decision', decision='UNKNOWN' WHERE id=:id"), {"id": alert_id})
    db.commit()
    assert database.migrate_db() == 1
    assert database.migrate_db() == 1
    assert db.scalar(text("SELECT decision FROM alert_events WHERE id=:id"), {"id": alert_id}) == "UNKNOWN"
    assert db.scalar(text("SELECT convalidated FROM pg_constraint WHERE conrelid='alert_events'::regclass "
                          "AND conname='alert_decision_valid'")) is False
    db.commit()
    assert staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).json()["canCheckIn"] is False
    assert check_in(staff_client, body).json()["error"]["code"] == "ALERT_BLOCKED"
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("UPDATE alert_events SET decision='INVALID' WHERE id=:id"), {"id": alert_id})
