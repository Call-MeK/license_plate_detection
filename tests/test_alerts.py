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
