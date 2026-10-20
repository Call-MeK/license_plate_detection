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
