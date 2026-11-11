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
    assert staff_client.post(review_url, json={"status": "REVIEWED", "note": "Verified the vehicle with supervisor"}).status_code == 200
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
    monkeypatch.setattr(recognition, "process_frame", lambda image, timings=None: (image, [{
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
