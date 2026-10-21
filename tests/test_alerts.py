from test_parking_checkin import prepare


def test_inactive_watchlist_does_not_alert_and_new_event_does_not_reuse_review(staff_client, admin_client):
    watch = admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Fictional test dossier", "status": "INACTIVE",
    }).json()
    _, clear = prepare(staff_client)
    assert clear["alerts"] == []
    assert admin_client.patch("/api/v1/stolen-vehicles/" + watch["id"], json={"status": "ACTIVE"}).status_code == 200
    body, first = prepare(staff_client)
    alert = first["alerts"][0]
    review_url = "/api/v1/alerts/" + alert["id"] + "/review"
    assert staff_client.post(review_url, json={"status": "REVIEWED", "decision": "ALLOW", "note": "Verified the vehicle with supervisor"}).status_code == 200
    assert staff_client.post(review_url, json={"status": "FALSE_POSITIVE", "note": "Overwrite"}).status_code == 409
    retry = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).json()
    assert retry["alerts"][0]["status"] == "REVIEWED"
    _, second = prepare(staff_client)
    assert second["alerts"][0]["id"] != alert["id"]
    assert second["alerts"][0]["status"] == "PENDING"


def test_staff_cannot_change_watchlist_dossier(staff_client, admin_client):
    watch = admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Fictional test dossier",
    }).json()
    assert staff_client.patch("/api/v1/stolen-vehicles/" + watch["id"], json={"status": "INACTIVE"}).status_code == 403


def test_alert_keeps_authenticated_crop_after_recognition_cancel(client, staff_client, admin_client, monkeypatch):
    from io import BytesIO
    from PIL import Image
    from app import recognition
    monkeypatch.setattr(recognition, "process_frame", lambda image: (image, [{
        "plate": "51F12345", "bbox": [10, 20, 60, 40],
        "ocr_confidence": .9, "detector_confidence": .9,
    }]))
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Fictional crop evidence test",
    })
    session = staff_client.post("/api/v1/recognition/sessions", json={"mode": "ENTRY"}).json()
    image = BytesIO()
    Image.new("RGB", (120, 80), (12, 34, 56)).save(image, format="PNG")
    path = "/api/v1/recognition/sessions/" + session["id"]
    frame = staff_client.post(path + "/frames", files={"frame": ("frame.png", image.getvalue(), "image/png")}, data={"sequence": 1})
    assert frame.status_code == 200, frame.text
    event = staff_client.post(path + "/confirm", json={"plateNumber": "51F12345"}).json()
    precheck = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json={
        "sourceEventId": event["sourceEventId"], "plateNumber": "51F12345", "vehicleType": "CAR",
    })
    assert precheck.status_code == 200, precheck.text
    alert = precheck.json()["alerts"][0]
    evidence_path = alert["evidence"]["imagePath"]
    assert evidence_path == f"/api/v1/alerts/{alert['id']}/evidence"
    assert "imageBase64" not in alert["evidence"]
    assert staff_client.delete(path).status_code == 200
    evidence = staff_client.get(evidence_path)
    assert evidence.status_code == 200
    assert evidence.headers["content-type"] == "image/jpeg"
    with Image.open(BytesIO(evidence.content)) as crop:
        assert crop.size == (50, 20)
    assert client.get(evidence_path).status_code == 401


def test_alert_review_distinguishes_allow_and_block(staff_client, admin_client):
    from test_parking_checkin import check_in, policy
    policy(admin_client)
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Stolen car report #999", "status": "ACTIVE",
    })
    body, precheck = prepare(staff_client)
    assert precheck["canCheckIn"] is False
    alert_id = precheck["alerts"][0]["id"]

    # 1. PENDING -> check-in blocked
    assert check_in(staff_client, body).status_code == 409

    # 2. Review without note is rejected (422)
    assert staff_client.post(f"/api/v1/alerts/{alert_id}/review", json={
        "status": "REVIEWED", "decision": "BLOCK", "note": "   "
    }).status_code == 422

    # 3. REVIEWED + BLOCK -> check-in blocked
    review_block = staff_client.post(f"/api/v1/alerts/{alert_id}/review", json={
        "status": "REVIEWED", "decision": "BLOCK", "note": "Confirmed stolen vehicle, police notified"
    })
    assert review_block.status_code == 200, review_block.text
    assert review_block.json()["decision"] == "BLOCK"

    precheck_after_block = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).json()
    assert precheck_after_block["canCheckIn"] is False

    # Check-in MUST BE BLOCKED
    checkin_block = check_in(staff_client, body)
    assert checkin_block.status_code == 409

    # 4. Cannot overwrite existing review (409)
    assert staff_client.post(f"/api/v1/alerts/{alert_id}/review", json={
        "status": "REVIEWED", "decision": "ALLOW", "note": "Overwrite attempt"
    }).status_code == 409

def test_alert_reviewed_allow_permits_checkin(staff_client, admin_client):
    from test_parking_checkin import check_in, policy
    policy(admin_client)
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Vehicle checked by supervisor", "status": "ACTIVE",
    })
    body, precheck = prepare(staff_client)
    assert precheck["canCheckIn"] is False
    alert_id = precheck["alerts"][0]["id"]

    # Review with ALLOW
    review = staff_client.post(f"/api/v1/alerts/{alert_id}/review", json={
        "status": "REVIEWED", "decision": "ALLOW", "note": "Documents verified, supervisor approved"
    })
    assert review.status_code == 200, review.text
    assert review.json()["decision"] == "ALLOW"

    # Precheck should now allow check-in
    precheck_after = staff_client.post("/api/v1/parking-sessions/check-in/precheck", json=body).json()
    assert precheck_after["canCheckIn"] is True

    # Check-in succeeds
    assert check_in(staff_client, body).status_code == 200


def test_concurrent_alert_reviews_do_not_overwrite(db, staff_client, admin_client):
    from concurrent.futures import ThreadPoolExecutor
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker
    from app.database import get_db
    from app.main import app

    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Concurrent review test", "status": "ACTIVE",
    })
    _, precheck = prepare(staff_client)
    alert_id = precheck["alerts"][0]["id"]

    factory = sessionmaker(db.get_bind(), expire_on_commit=False)

    def fresh_db():
        with factory.begin() as session:
            yield session

    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = fresh_db
    headers, cookies = dict(staff_client.headers), dict(staff_client.cookies)

    def submit(decision):
        with TestClient(app, headers=headers, cookies=cookies) as client:
            return client.post(f"/api/v1/alerts/{alert_id}/review", json={
                "status": "REVIEWED", "decision": decision, "note": f"Concurrent decision {decision}"
            })

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(submit, ["ALLOW", "BLOCK"]))
    finally:
        app.dependency_overrides[get_db] = previous

    status_codes = sorted(r.status_code for r in responses)
    assert status_codes == [200, 409], f"One review must succeed, one must fail 409: {status_codes}"


def test_alert_survives_when_checkin_not_completed(staff_client, admin_client):
    from test_parking_checkin import policy
    policy(admin_client)
    admin_client.post("/api/v1/stolen-vehicles", json={
        "plateNumber": "51F12345", "description": "Incomplete checkin alert test", "status": "ACTIVE",
    })
    body, precheck = prepare(staff_client)
    assert precheck["canCheckIn"] is False
    alert_id = precheck["alerts"][0]["id"]

    # Even without completing check-in, alert must exist in list
    alerts = staff_client.get("/api/v1/alerts").json()
    assert alerts["total"] >= 1
    found = next((a for a in alerts["items"] if a["id"] == alert_id), None)
    assert found is not None
    assert found["status"] == "PENDING"
