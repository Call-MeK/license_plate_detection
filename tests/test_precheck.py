from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from test_parking_checkin import check_in, manual, policy, prepare


def test_precheck_rejects_forged_or_changed_plate(staff_client):
    body = {"plateNumber": "51F12345", "vehicleType": "CAR", "sourceEventId": str(uuid4())}
    assert staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).status_code in (404, 409, 410)
    event = manual(staff_client)
    body.update(sourceEventId=event["sourceEventId"], plateNumber="51F12346")
    assert staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).status_code == 409


def test_pending_alert_survives_cancel_retries_and_requires_review(staff_client, admin_client):
    policy(admin_client)
    watch = admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Fictional QA watchlist", "status": "ACTIVE",
    })
    assert watch.status_code in (200, 201), watch.text
    body, result = prepare(staff_client)
    assert result["canCheckIn"] is False
    alert = result["alerts"][0]
    retry = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body)
    assert retry.json()["alerts"][0]["id"] == alert["id"]
    assert check_in(staff_client, body).status_code == 409
    assert staff_client.get("/api/v1/alerts").json()["total"] == 1
    assert staff_client.post(f"/api/v1/alerts/{alert['id']}/review", json={"status": "REVIEWED", "note": " "}).status_code == 422
    review = staff_client.post(f"/api/v1/alerts/{alert['id']}/review", json={"status": "FALSE_POSITIVE", "note": "Staff verified documents"})
    assert review.status_code == 200, review.text
    assert check_in(staff_client, body).status_code == 200


def test_watchlist_added_after_precheck_cannot_bypass_review(staff_client, admin_client):
    policy(admin_client)
    body, result = prepare(staff_client)
    assert result["canCheckIn"] is True
    assert admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Added during checkin", "status": "ACTIVE",
    }).status_code in (200, 201)
    assert check_in(staff_client, body).status_code == 409
    alerts = staff_client.get("/api/v1/alerts").json()
    assert alerts["total"] == 1
    assert alerts["items"][0]["status"] == "PENDING"


def test_precheck_allows_changing_vehicle_type(staff_client, admin_client):
    policy(admin_client)
    admin_client.post("/api/v1/pricing-policies", json={
        "vehicleType": "MOTORBIKE", "hourlyRate": 3000, "roundingMinutes": 30,
    })
    event = manual(staff_client)
    body_car = {"plateNumber": event["plateNumber"], "vehicleType": "CAR", "sourceEventId": event["sourceEventId"]}
    res1 = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body_car)
    assert res1.status_code == 200, res1.text
    assert res1.json()["canCheckIn"] is True

    # Change vehicle type to MOTORBIKE and precheck again
    body_bike = {"plateNumber": event["plateNumber"], "vehicleType": "MOTORBIKE", "sourceEventId": event["sourceEventId"]}
    res2 = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body_bike)
    assert res2.status_code == 200, res2.text
    assert res2.json()["canCheckIn"] is True

    # Check-in with old CAR payload must be rejected
    assert check_in(staff_client, body_car).status_code == 409

    # Check-in with new MOTORBIKE payload must succeed
    assert check_in(staff_client, body_bike).status_code == 200


def test_precheck_change_vehicle_type_does_not_duplicate_alerts(staff_client, admin_client):
    policy(admin_client)
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Watchlist test", "status": "ACTIVE",
    })
    event = manual(staff_client)
    body_car = {"plateNumber": event["plateNumber"], "vehicleType": "CAR", "sourceEventId": event["sourceEventId"]}
    res1 = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body_car).json()
    assert res1["canCheckIn"] is False
    assert len(res1["alerts"]) == 1
    alert_id = res1["alerts"][0]["id"]

    body_bike = {"plateNumber": event["plateNumber"], "vehicleType": "MOTORBIKE", "sourceEventId": event["sourceEventId"]}
    res2 = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body_bike).json()
    assert res2["canCheckIn"] is False
    assert len(res2["alerts"]) == 1
    assert res2["alerts"][0]["id"] == alert_id

    # Check total alerts in system
    alerts = staff_client.get("/api/v1/alerts").json()
    assert alerts["total"] == 1


def test_concurrent_prechecks_handle_changing_vehicle_type(db, staff_client, admin_client):
    from app.database import get_db
    from app.main import app
    policy(admin_client)
    event = manual(staff_client)
    body_car = {"plateNumber": event["plateNumber"], "vehicleType": "CAR", "sourceEventId": event["sourceEventId"]}
    body_bike = {"plateNumber": event["plateNumber"], "vehicleType": "MOTORBIKE", "sourceEventId": event["sourceEventId"]}

    factory = sessionmaker(db.get_bind(), expire_on_commit=False)

    def fresh_db():
        with factory.begin() as session:
            yield session

    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = fresh_db
    headers, cookies = dict(staff_client.headers), dict(staff_client.cookies)

    def submit(body):
        with TestClient(app, headers=headers, cookies=cookies) as client:
            return client.post("/api/v1/parking-sessions/check-in/precheck", json=body)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(submit, [body_car, body_bike]))
    finally:
        app.dependency_overrides[get_db] = previous

    for r in responses:
        assert r.status_code == 200, r.text
