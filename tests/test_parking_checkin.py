from uuid import uuid4


def manual(client, plate="51F-123.45", mode="ENTRY"):
    response = client.post("/api/v1/recognition/manual", json={
        "plateNumber": plate, "mode": mode, "reason": "Webcam demo unavailable",
    })
    assert response.status_code == 200, response.text
    return response.json()


def prepare(client, plate="51F-123.45", vehicle_type="CAR"):
    event = manual(client, plate)
    body = {"sourceEventId": event["sourceEventId"], "plateNumber": plate,
            "vehicleType": vehicle_type}
    response = client.post("/api/v1/parking-sessions/check-in/precheck", json=body)
    assert response.status_code == 200, response.text
    return body, response.json()


def policy(client, rate=5000):
    response = client.post("/api/v1/pricing-policies", json={
        "vehicleType": "CAR", "hourlyRate": rate, "roundingMinutes": 30,
    })
    assert response.status_code in (200, 201), response.text
    return response.json()


def check_in(client, body, key=None):
    return client.post("/api/v1/parking-sessions/check-in", json=body,
                       headers={"Idempotency-Key": key or str(uuid4())})


def test_checkin_normalizes_snapshots_and_replays(staff_client, admin_client):
    original = policy(admin_client)
    body, precheck = prepare(staff_client)
    assert precheck["canCheckIn"] is True
    key = str(uuid4())
    first = check_in(staff_client, body, key)
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["plateNumber"] == "51F12345"
    assert result["status"] == "ACTIVE"
    assert str(result["pricingSnapshot"]["hourlyRate"]) in ("5000", "5000.00")
    assert result["pricingSnapshot"]["version"] == original["version"]
    assert check_in(staff_client, body, key).json() == result
    assert check_in(staff_client, body).status_code == 409
    assert check_in(staff_client, {**body, "vehicleType": "MOTORBIKE"}, key).status_code == 409


def test_checkin_requires_server_precheck_and_key(staff_client, admin_client):
    policy(admin_client)
    event = manual(staff_client)
    body = {"plateNumber": event["plateNumber"], "sourceEventId": event["sourceEventId"], "vehicleType": "CAR"}
    assert check_in(staff_client, body).status_code == 409
    assert staff_client.post("/api/v1/parking-sessions/check-in", json=body).status_code == 422


def test_cannot_reuse_same_recognition_event_for_second_session(staff_client, admin_client):
    policy(admin_client)
    body, _ = prepare(staff_client)
    key1 = str(uuid4())
    first = check_in(staff_client, body, key1)
    assert first.status_code == 200, first.text

    # Complete the first session by checking out
    session_id = first.json()["id"]
    preview = staff_client.post(f"/api/v1/parking-sessions/{session_id}/fee-preview").json()
    event_exit = manual(staff_client, mode="EXIT")
    out = staff_client.post(f"/api/v1/parking-sessions/{session_id}/check-out", json={
        "plateNumber": event_exit["plateNumber"], "sourceEventId": event_exit["sourceEventId"],
        "paymentMethod": "CASH", "paymentConfirmed": True, "expectedFee": preview["fee"],
    }, headers={"Idempotency-Key": str(uuid4())})
    assert out.status_code == 200, out.text

    # Now attempt to check in again using the original entry sourceEventId but a new idempotency key
    key2 = str(uuid4())
    second = check_in(staff_client, body, key2)
    assert second.status_code == 409, "Reusing a consumed recognition event must be rejected"

def test_retry_same_key_after_success_returns_saved_result(staff_client, admin_client):
    policy(admin_client)
    body, _ = prepare(staff_client)
    key = str(uuid4())
    first = check_in(staff_client, body, key)
    assert first.status_code == 200, first.text
    # Retry with same key and payload returns saved result
    retry = check_in(staff_client, body, key)
    assert retry.status_code == 200, retry.text
    assert retry.json() == first.json()
    # Retry with same key but different payload fails with 409
    diff_payload = {**body, "vehicleType": "MOTORBIKE"}
    assert check_in(staff_client, diff_payload, key).status_code == 409


def test_concurrent_checkins_with_same_event_different_keys(db, staff_client, admin_client):
    from concurrent.futures import ThreadPoolExecutor
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import func, select
    from app.database import get_db
    from app.main import app
    from app.models import ParkingSession

    policy(admin_client)
    body, _ = prepare(staff_client)
    keys = [str(uuid4()), str(uuid4())]

    factory = sessionmaker(db.get_bind(), expire_on_commit=False)

    def fresh_db():
        with factory.begin() as session:
            yield session

    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = fresh_db
    headers, cookies = dict(staff_client.headers), dict(staff_client.cookies)

    def submit(key):
        with TestClient(app, headers=headers, cookies=cookies) as client:
            return check_in(client, body, key)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(submit, keys))
    finally:
        app.dependency_overrides[get_db] = previous

    status_codes = sorted(r.status_code for r in responses)
    assert status_codes == [200, 409]
    assert db.scalar(select(func.count()).select_from(ParkingSession).where(ParkingSession.status == "ACTIVE")) == 1


def test_checkin_rollback_does_not_consume_event(db, staff_client, admin_client, monkeypatch):
    from app import parking
    from app.models import IdempotencyRecord
    from sqlalchemy import select
    import pytest

    policy(admin_client)
    body, _ = prepare(staff_client)

    def fail_audit(*args, **kwargs):
        raise RuntimeError("Simulated audit failure before commit")

    monkeypatch.setattr(parking, "audit", fail_audit)
    with pytest.raises(RuntimeError, match="audit failure"):
        check_in(staff_client, body)

    # Verify EVENT_CONSUMED is not in DB
    consumed = db.scalar(select(IdempotencyRecord.id).where(
        IdempotencyRecord.operation == "EVENT_CONSUMED",
        IdempotencyRecord.key == body["sourceEventId"]
    ))
    assert consumed is None

    # Restore audit and retry check-in with the same event: must succeed
    monkeypatch.undo()
    res = check_in(staff_client, body)
    assert res.status_code == 200, res.text


def test_restart_preserves_event_consumed_status(staff_client, admin_client):
    from app import recognition
    from datetime import timedelta
    policy(admin_client)
    body, _ = prepare(staff_client)
    res = check_in(staff_client, body)
    assert res.status_code == 200, res.text

    # Complete the session so plate is not ALREADY_PARKED
    session_id = res.json()["id"]
    preview = staff_client.post(f"/api/v1/parking-sessions/{session_id}/fee-preview").json()
    event_exit = manual(staff_client, mode="EXIT")
    staff_client.post(f"/api/v1/parking-sessions/{session_id}/check-out", json={
        "plateNumber": event_exit["plateNumber"], "sourceEventId": event_exit["sourceEventId"],
        "paymentMethod": "CASH", "paymentConfirmed": True, "expectedFee": preview["fee"],
    }, headers={"Idempotency-Key": str(uuid4())})

    # Simulate server restart by clearing in-memory events and recreating unexpired observation
    recognition._events.clear()
    recognition._events[body["sourceEventId"]] = {
        "sourceEventId": body["sourceEventId"],
        "plateNumber": "51F12345",
        "actorId": str(res.json()["vehicleId"]), # will get staff.id below
        "mode": "ENTRY",
        "manual": True,
        "reason": "Simulated post-restart event",
        "expiresAt": recognition.utcnow() + timedelta(minutes=5),
        "bbox": None,
        "confidence": None,
        "imageBase64": None,
    }
    # Update actorId to current staff user
    me = staff_client.get("/api/v1/auth/me").json()
    recognition._events[body["sourceEventId"]]["actorId"] = me["id"]

    # Now attempt check-in with new key: must be rejected with 409 because DB remembers EVENT_CONSUMED
    attempt = check_in(staff_client, body, str(uuid4()))
    assert attempt.status_code == 409
    assert attempt.json()["error"]["code"] == "EVENT_ALREADY_USED"
