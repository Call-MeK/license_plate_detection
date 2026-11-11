from datetime import datetime
from uuid import uuid4

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


def test_vehicle_type_can_change_after_precheck(staff_client, admin_client):
    policy(admin_client)
    response = admin_client.post("/api/v1/pricing-policies", json={
        "vehicleType": "MOTORBIKE", "hourlyRate": 2000, "roundingMinutes": 30,
    })
    assert response.status_code in (200, 201), response.text
    body, result = prepare(staff_client, vehicle_type="CAR")
    assert result["canCheckIn"] is True
    changed = {**body, "vehicleType": "MOTORBIKE"}
    rerun = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=changed)
    assert rerun.status_code == 200, rerun.text
    assert rerun.json() == result
    entered = check_in(staff_client, changed)
    assert entered.status_code == 200, entered.text
    assert entered.json()["vehicleType"] == "MOTORBIKE"


def test_checkin_with_other_plate_than_precheck_requires_precheck(staff_client, admin_client):
    policy(admin_client)
    body, _ = prepare(staff_client)
    # The event pins the plate, so only a differently written plate reaches the precheck lookup.
    response = check_in(staff_client, {**body, "plateNumber": "51F12345"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PRECHECK_REQUIRED"
    assert check_in(staff_client, {**body, "plateNumber": "51F12346"}).status_code == 409


def test_precheck_reports_a_vehicle_that_is_already_parked(staff_client, admin_client):
    """Nhân viên phải biết ngay ở bước kiểm tra, không đợi bấm ghi nhận mới bị từ chối."""
    policy(admin_client)
    body, result = prepare(staff_client)
    assert result["canCheckIn"] is True and result["activeSession"] is None
    first = check_in(staff_client, body)
    assert first.status_code == 200, first.text
    _, again = prepare(staff_client)
    assert again["canCheckIn"] is False
    assert again["activeSession"]["id"] == first.json()["id"]
    assert datetime.fromisoformat(again["activeSession"]["checkInAt"]) == datetime.fromisoformat(first.json()["checkInAt"])
