from datetime import datetime, timedelta
from uuid import uuid4

from test_parking_checkin import check_in, manual, policy, prepare


def active_session(staff_client, admin_client, db, minutes=95):
    from app.database import utcnow
    from app.models import ParkingSession
    policy(admin_client)
    body, _ = prepare(staff_client)
    response = check_in(staff_client, body)
    assert response.status_code == 200, response.text
    session = db.get(ParkingSession, response.json()["id"])
    session.check_in_at = utcnow() - timedelta(minutes=minutes, seconds=-3)
    db.commit()
    return response.json()["id"]


def test_checkout_uses_snapshot_requires_payment_and_expected_fee(staff_client, admin_client, db):
    session_id = active_session(staff_client, admin_client, db)
    policy(admin_client, 9000)
    base = f"/api/v1/parking-sessions/{session_id}"
    preview = staff_client.post(base + "/fee-preview").json()
    assert preview["fee"] == 10000
    event = manual(staff_client, mode="EXIT")
    body = {"sourceEventId": event["sourceEventId"], "plateNumber": event["plateNumber"],
            "paymentMethod": "CASH", "paymentConfirmed": False, "expectedFee": 10000}
    headers = {"Idempotency-Key": str(uuid4())}
    assert staff_client.post(base + "/check-out", json=body, headers=headers).status_code == 422
    body.update(paymentConfirmed=True, expectedFee=5000)
    mismatch = staff_client.post(base + "/check-out", json=body, headers=headers)
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "FEE_CHANGED"
    assert staff_client.get("/api/v1/parking-sessions?status=ACTIVE").json()["total"] == 1
    body["expectedFee"] = 10000
    complete = staff_client.post(base + "/check-out", json=body, headers=headers)
    assert complete.status_code == 200, complete.text
    assert complete.json()["fee"] == 10000
    assert complete.json()["status"] == "COMPLETED"
    assert staff_client.post(base + "/check-out", json=body, headers=headers).json() == complete.json()
    assert staff_client.post(base + "/check-out", json=body, headers={"Idempotency-Key": str(uuid4())}).status_code == 409


def test_manual_checkout_session_selection_requires_reason(staff_client, admin_client, db):
    session_id = active_session(staff_client, admin_client, db)
    event = manual(staff_client, "51F12346", "EXIT")
    body = {"sourceEventId": event["sourceEventId"], "plateNumber": event["plateNumber"],
            "paymentMethod": "TRANSFER", "paymentConfirmed": True, "expectedFee": 10000}
    url = f"/api/v1/parking-sessions/{session_id}/check-out"
    headers = {"Idempotency-Key": str(uuid4())}
    assert staff_client.post(url, json=body, headers=headers).status_code == 422
    body["manualSelectionReason"] = "Verified original parking receipt"
    assert staff_client.post(url, json=body, headers=headers).status_code == 200


def test_checkout_fee_and_recorded_time_use_one_instant(staff_client, admin_client, db, monkeypatch):
    from app import parking
    from app.database import utcnow
    from app.models import ParkingSession
    session_id = active_session(staff_client, admin_client, db)
    boundary = utcnow()
    item = db.get(ParkingSession, session_id)
    item.check_in_at = boundary - timedelta(minutes=60)
    db.commit()
    event = manual(staff_client, mode="EXIT")
    clock = iter([boundary, boundary + timedelta(seconds=1)])
    monkeypatch.setattr(parking, "utcnow", lambda: next(clock))
    response = staff_client.post(f"/api/v1/parking-sessions/{session_id}/check-out", json={
        "sourceEventId": event["sourceEventId"], "plateNumber": event["plateNumber"],
        "paymentMethod": "CASH", "paymentConfirmed": True, "expectedFee": 5000,
    }, headers={"Idempotency-Key": str(uuid4())})
    assert response.status_code == 200, response.text
    assert datetime.fromisoformat(response.json()["checkOutAt"]) == boundary
    assert response.json()["fee"] == 5000


def test_exit_event_cannot_be_reused_across_checkout_sessions(staff_client, admin_client, db):
    session_id1 = active_session(staff_client, admin_client, db)
    body2, _ = prepare(staff_client, plate="51F-999.99")
    res2 = check_in(staff_client, body2)
    assert res2.status_code == 200, res2.text
    session_id2 = res2.json()["id"]

    event_exit = manual(staff_client, mode="EXIT")
    preview1 = staff_client.post(f"/api/v1/parking-sessions/{session_id1}/fee-preview").json()
    res_out1 = staff_client.post(f"/api/v1/parking-sessions/{session_id1}/check-out", json={
        "sourceEventId": event_exit["sourceEventId"], "plateNumber": event_exit["plateNumber"],
        "paymentMethod": "CASH", "paymentConfirmed": True, "expectedFee": preview1["fee"],
    }, headers={"Idempotency-Key": str(uuid4())})
    assert res_out1.status_code == 200, res_out1.text

    # Attempt to use the same exit event for session_id2
    preview2 = staff_client.post(f"/api/v1/parking-sessions/{session_id2}/fee-preview").json()
    res_out2 = staff_client.post(f"/api/v1/parking-sessions/{session_id2}/check-out", json={
        "sourceEventId": event_exit["sourceEventId"], "plateNumber": event_exit["plateNumber"],
        "paymentMethod": "CASH", "paymentConfirmed": True, "expectedFee": preview2["fee"],
        "manualSelectionReason": "Different plate verified",
    }, headers={"Idempotency-Key": str(uuid4())})
    assert res_out2.status_code == 409
    assert res_out2.json()["error"]["code"] == "EVENT_ALREADY_USED"
