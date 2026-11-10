from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from test_parking_checkin import check_in, manual, policy, prepare
from test_parking_checkout import active_session


@pytest.mark.parametrize("same_key", [False, True])
def test_postgres_concurrent_checkins_create_exactly_one_active(db, staff_client, admin_client, same_key):
    from app.database import get_db
    from app.main import app
    from app.models import ParkingSession
    policy(admin_client)
    first, _ = prepare(staff_client)
    second = first if same_key else prepare(staff_client)[0]
    keys = [str(uuid4()), str(uuid4())]
    if same_key:
        keys[1] = keys[0]
    factory = sessionmaker(db.get_bind(), expire_on_commit=False)

    def fresh_db():
        with factory.begin() as session:
            yield session

    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = fresh_db
    headers, cookies = dict(staff_client.headers), dict(staff_client.cookies)

    def submit(index):
        with TestClient(app, base_url="https://testserver", headers=headers, cookies=cookies) as client:
            return check_in(client, [first, second][index], keys[index])

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(submit, [0, 1]))
    finally:
        app.dependency_overrides[get_db] = previous
    assert sorted(r.status_code for r in responses) == ([200, 200] if same_key else [200, 409])
    if same_key:
        assert responses[0].json() == responses[1].json()
    assert db.scalar(select(func.count()).select_from(ParkingSession).where(ParkingSession.status == "ACTIVE")) == 1


def test_confirmed_observation_expiry_blocks_precheck_but_retry_replays(staff_client, admin_client, monkeypatch):
    from app import recognition
    policy(admin_client)
    body, _ = prepare(staff_client)
    key = str(uuid4())
    first = check_in(staff_client, body, key)
    assert first.status_code == 200
    future = recognition.utcnow() + timedelta(seconds=61)
    monkeypatch.setattr(recognition, "utcnow", lambda: future)
    assert staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).status_code == 410
    assert check_in(staff_client, body, key).json() == first.json()
    assert check_in(staff_client, body).status_code == 410


def test_fee_across_midnight_is_continuous(monkeypatch):
    from app import parking
    monkeypatch.setattr(parking, "utcnow", lambda: datetime(2026, 10, 19, 0, 35, tzinfo=timezone.utc))
    session = SimpleNamespace(id="midnight", check_in_at=datetime(2026, 10, 18, 23, 25, tzinfo=timezone.utc),
                              pricing_snapshot={"hourlyRate": "5000", "roundingMinutes": 30})
    preview = parking.fee_preview(session)
    assert preview["durationMinutes"] == 70
    assert preview["fee"] == 7500


def test_vehicle_edit_does_not_rewrite_history_snapshot(db, staff_client, admin_client):
    session_id = active_session(staff_client, admin_client, db)
    event = manual(staff_client, mode="EXIT")
    result = staff_client.post(f"/api/v1/parking-sessions/{session_id}/check-out", json={
        "plateNumber": event["plateNumber"], "sourceEventId": event["sourceEventId"],
        "paymentMethod": "CASH", "paymentConfirmed": True, "expectedFee": 10000,
    }, headers={"Idempotency-Key": str(uuid4())})
    assert result.status_code == 200, result.text
    vehicle_id = result.json()["vehicleId"]
    updated = admin_client.patch(f"/api/v1/vehicles/{vehicle_id}", json={"plateNumber": "51F12346"})
    assert updated.status_code == 200, updated.text
    history = staff_client.get(f"/api/v1/vehicles/{vehicle_id}/history").json()
    assert history["items"][0]["plateNumber"] == "51F12345"
    assert history["items"][0]["fee"] == 10000


def test_checkin_audit_failure_rolls_back_vehicle_and_session(db, staff_client, admin_client, monkeypatch):
    from app import parking
    from app.models import ParkingSession, Vehicle
    policy(admin_client)
    body, _ = prepare(staff_client)

    def fail_audit(*args, **kwargs):
        raise RuntimeError("Simulated audit storage failure")

    monkeypatch.setattr(parking, "audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit storage"):
        check_in(staff_client, body)
    assert db.scalar(select(func.count()).select_from(ParkingSession)) == 0
    assert db.scalar(select(func.count()).select_from(Vehicle)) == 0
