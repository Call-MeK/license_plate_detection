from test_parking_checkin import check_in, policy, prepare


def test_staff_cannot_manage_policies_watchlist_users_or_audit(staff_client):
    for path, body in [
        ("pricing-policies", {"vehicleType": "CAR", "hourlyRate": 5000, "roundingMinutes": 30}),
        ("stolen-vehicles", {"plateNumber": "51F12345", "description": "QA"}),
        ("users", {"username": "intruder", "password": "StrongPassword123!", "role": "ADMIN"}),
    ]:
        assert staff_client.post("/api/v1/" + path, json=body).status_code == 403
    assert staff_client.get("/api/v1/audit-logs").status_code == 403


def test_active_vehicle_locked_and_audit_filters_work(staff_client, admin_client):
    policy(admin_client)
    body, _ = prepare(staff_client)
    session = check_in(staff_client, body).json()
    url = "/api/v1/vehicles/" + session["vehicleId"]
    assert staff_client.patch(url, json={"plateNumber": "51F12346"}).status_code == 403
    assert admin_client.patch(url, json={"plateNumber": "51F12346"}).status_code == 409
    assert admin_client.get(url + "/history").json()["total"] == 1
    logs = admin_client.get("/api/v1/audit-logs?action=PARKING_CHECK_IN&entityType=ParkingSession").json()
    assert logs["total"] == 1
    assert logs["items"][0]["entityId"] == session["id"]
    assert "password" not in str(logs).lower()
    assert "csrf" not in str(logs).lower()
