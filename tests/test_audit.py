from test_parking_checkin import policy


def test_audit_is_paginated_filters_dates_and_hides_nonadmin(staff_client, admin_client):
    policy(admin_client)
    policy(admin_client, 6000)
    page = admin_client.get("/api/v1/audit-logs?action=PRICING_CREATED&pageSize=1&page=1").json()
    assert page["total"] == 2
    assert len(page["items"]) == 1
    second = admin_client.get("/api/v1/audit-logs?action=PRICING_CREATED&pageSize=1&page=2").json()
    assert second["items"][0]["id"] != page["items"][0]["id"]
    assert admin_client.get("/api/v1/audit-logs?dateFrom=2999-01-01T00:00:00Z").json()["total"] == 0
    assert admin_client.get("/api/v1/audit-logs?dateFrom=2026-01-01T00:00:00").status_code == 422
    assert staff_client.get("/api/v1/audit-logs").status_code == 403
