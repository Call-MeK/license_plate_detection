"""Recognition security and voting use real routes; only model inference is replaced."""
from datetime import timedelta
from io import BytesIO
from threading import Event, Thread
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def api(monkeypatch):
    from app import recognition as r
    from app.auth import current_user, csrf_protect
    from app.database import get_db

    r._sessions.clear()
    r._events.clear()
    app = FastAPI()
    app.include_router(r.router, prefix="/api/v1")
    user = SimpleNamespace(id="user-a", role="STAFF")
    app.dependency_overrides[current_user] = lambda: user
    app.dependency_overrides[csrf_protect] = lambda: None
    app.dependency_overrides[get_db] = lambda: None
    observations = [observation()]
    monkeypatch.setattr(r, "process_frame", lambda frame, timings=None: (frame, observations.copy()))
    monkeypatch.setattr(r.config, "USE_STUB", True)
    monkeypatch.setattr(r, "_record_type", lambda db, plate: None)
    clock = [r.utcnow()]
    monkeypatch.setattr(r, "utcnow", lambda: clock[0])
    output = BytesIO()
    Image.new("RGB", (120, 80)).save(output, format="JPEG")
    return SimpleNamespace(client=TestClient(app), module=r, observations=observations,
                           user=user, clock=clock, image=output.getvalue())


def observation(plate="51F12345", bbox=(10, 20, 60, 40), confidence=.9, lines=()):
    return {"plate": plate, "bbox": bbox, "ocr_confidence": confidence,
            "detector_confidence": .9, "valid": True, "lines": list(lines)}


def create(api):
    response = api.client.post("/api/v1/recognition/sessions", json={"mode": "ENTRY"})
    assert response.status_code == 200
    return response.json()["id"]


def frame(api, sid, sequence):
    return api.client.post(f"/api/v1/recognition/sessions/{sid}/frames",
                           files={"frame": ("frame.jpg", api.image, "image/jpeg")},
                           data={"sequence": sequence})


def confirm(api, sid, **body):
    return api.client.post(f"/api/v1/recognition/sessions/{sid}/confirm",
                           json={"plateNumber": "51F12345", **body})


def test_two_confident_frames_become_stable(api):
    api.observations[:] = [observation(confidence=.95)]  # tích .855
    sid = create(api)
    assert frame(api, sid, 1).json()["status"] == "UNCERTAIN"
    result = frame(api, sid, 2).json()
    assert result["status"] == "STABLE"
    assert result["state"] == "READY"


def test_agreeing_votes_become_stable_and_require_staff_confirmation(api):
    api.observations[:] = [observation(confidence=.7)]  # tích .63 < .8: vẫn cần 3 khung
    sid = create(api)
    assert frame(api, sid, 1).json()["status"] == "UNCERTAIN"
    assert frame(api, sid, 2).json()["status"] == "UNCERTAIN"
    result = frame(api, sid, 3).json()
    assert result["status"] == "STABLE"
    assert result["state"] == "READY"
    assert result["plateNumber"] == "51F12345"
    assert result["stub"] is True
    token = confirm(api, sid).json()["sourceEventId"]
    assert api.module.verify_event(token, "51F12345", "user-a", "ENTRY")["manual"] is False


def test_frame_upload_logs_step_timings(api, caplog):
    sid = create(api)
    with caplog.at_level("INFO", logger="app.recognition"):
        assert frame(api, sid, 1).status_code == 200
    messages = [record.getMessage() for record in caplog.records if record.name == "app.recognition"]
    assert any(all(key in message for key in (
        "decode_ms=", "detect_ms=", "ocr_ms=", "total_ms=", "status="))
        for message in messages)


def test_multiple_detected_plates_read_only_largest_without_target_prompt(api, monkeypatch):
    from src import pipeline
    detector = Mock(return_value=[(0, 0, 20, 10, .95), (10, 20, 90, 60, .8)])
    ocr = Mock(return_value=(["51F12345"], .9))
    monkeypatch.setattr(pipeline, "detect_plates", detector)
    monkeypatch.setattr(pipeline, "read_plate_lines", ocr)
    monkeypatch.setattr(api.module, "process_frame", pipeline.process_frame)
    sid = create(api)
    result = frame(api, sid, 1).json()
    assert result["needsTarget"] is False
    assert result["candidates"][0]["bbox"] == [10, 20, 90, 60]
    assert len(result["candidates"]) == 1
    ocr.assert_called_once()


def test_weighted_votes_ignore_invalid_plates_and_low_confidence(api):
    sid = create(api)
    for seq in range(1, 4):
        api.observations[:] = [observation("garbage", confidence=.99)]
        assert frame(api, sid, seq).json()["status"] == "UNCERTAIN"
    for seq in range(4, 7):
        api.observations[:] = [observation(confidence=.1)]
        assert frame(api, sid, seq).json()["status"] == "UNCERTAIN"


def test_multiple_plates_need_explicit_target_and_reset_votes(api):
    sid = create(api)
    api.observations[:] = [observation(confidence=.7), observation("59A112345", (65, 20, 115, 40), .7)]
    for seq in range(1, 4):
        result = frame(api, sid, seq).json()
        assert result["needsTarget"] is True
        assert result["status"] == "UNCERTAIN"
    assert confirm(api, sid).status_code == 409
    response = api.client.post(f"/api/v1/recognition/sessions/{sid}/target",
                               json={"bbox": [10, 20, 60, 40]})
    assert response.status_code == 200
    for seq in range(4, 7):
        result = frame(api, sid, seq).json()
    assert result["status"] == "STABLE"
    token = confirm(api, sid).json()["sourceEventId"]
    api.client.post(f"/api/v1/recognition/sessions/{sid}/target",
                    json={"bbox": [65, 20, 115, 40]})
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")


def test_frames_invalidate_confirmation_and_are_sequential(api):
    sid = create(api)
    assert frame(api, sid, 2).status_code == 409
    assert frame(api, sid, 1).status_code == 200
    token = confirm(api, sid).json()["sourceEventId"]
    assert frame(api, sid, 1).status_code == 409
    assert frame(api, sid, 2).status_code == 200
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")


def test_ownership_forgery_plate_mode_and_expiry_are_enforced(api):
    sid = create(api)
    frame(api, sid, 1)
    token = confirm(api, sid).json()["sourceEventId"]
    for event, plate, actor, mode in [("forged", "51F12345", "user-a", None),
                                      (token, "51F12345", "user-b", None),
                                      (token, "59A112345", "user-a", None),
                                      (token, "51F12345", "user-a", "EXIT")]:
        with pytest.raises(HTTPException):
            api.module.verify_event(event, plate, actor, mode)
    api.user.id = "user-b"
    assert api.client.get(f"/api/v1/recognition/sessions/{sid}").status_code == 404
    api.user.id = "user-a"
    api.clock[0] += timedelta(seconds=61)
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")


def test_frames_do_not_extend_collecting_or_ready_lifetime(api):
    sid = create(api)
    api.clock[0] += timedelta(seconds=14)
    frame(api, sid, 1)
    api.clock[0] += timedelta(seconds=2)
    assert frame(api, sid, 2).status_code == 410
    sid = create(api)
    for seq in range(1, 4):
        frame(api, sid, seq)
    api.clock[0] += timedelta(seconds=59)
    assert frame(api, sid, 4).status_code == 200
    api.clock[0] += timedelta(seconds=2)
    assert frame(api, sid, 5).status_code == 410


def test_image_validation_and_ai_failure_are_clear(api, monkeypatch):
    sid = create(api)
    api.image = b"not an image"
    assert frame(api, sid, 1).status_code == 422
    output = BytesIO()
    Image.new("RGB", (2000, 1200)).save(output, format="PNG")
    api.image = output.getvalue()
    assert frame(api, sid, 1).status_code == 413
    Image.new("RGB", (120, 80)).save(output := BytesIO(), format="JPEG")
    api.image = output.getvalue()
    def unavailable(frame, timings=None):
        raise RuntimeError("private path or model failure")
    monkeypatch.setattr(api.module, "process_frame", unavailable)
    result = frame(api, sid, 1)
    assert result.status_code == 503
    assert "AI_UNAVAILABLE" in result.text


def test_new_session_deletes_previous_user_observation(api):
    sid = create(api)
    frame(api, sid, 1)
    token = confirm(api, sid).json()["sourceEventId"]
    create(api)
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")


def test_manual_and_correction_require_reason_before_database_access(api):
    assert api.client.post("/api/v1/recognition/manual", json={
        "plateNumber": "51F12345", "mode": "ENTRY", "reason": " "}).status_code == 422
    sid = create(api)
    frame(api, sid, 1)
    assert confirm(api, sid, plateNumber="59A112345").status_code == 422


def test_session_expiry_during_inference_cannot_be_revived_by_stability(api, monkeypatch):
    api.observations[:] = [observation(confidence=.7)]  # tích .63 < .8: khung 3 mới chốt
    sid = create(api)
    frame(api, sid, 1)
    frame(api, sid, 2)
    def slow_inference(image, timings=None):
        api.clock[0] += timedelta(seconds=16)
        return image, api.observations
    monkeypatch.setattr(api.module, "process_frame", slow_inference)
    assert frame(api, sid, 3).status_code == 410
    assert confirm(api, sid).status_code == 410


def test_delete_and_invalid_target_cannot_leave_a_usable_observation(api):
    sid = create(api)
    assert confirm(api, sid).status_code == 409
    frame(api, sid, 1)
    assert api.client.post(f"/api/v1/recognition/sessions/{sid}/target",
                           json={"bbox": [0, 0, 120, 80]}).status_code == 422
    token = confirm(api, sid).json()["sourceEventId"]
    assert confirm(api, sid).json()["sourceEventId"] == token
    assert api.client.delete(f"/api/v1/recognition/sessions/{sid}").status_code == 200
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")


def test_target_change_waits_until_parking_finishes_its_event_guard(api):
    sid = create(api)
    api.observations.append(observation("59A112345", (65, 20, 115, 40)))
    frame(api, sid, 1)
    api.module.select_target(sid, api.module.TargetInput(bbox=(10, 20, 60, 40)), api.user)
    token = confirm(api, sid).json()["sourceEventId"]
    started, finished = Event(), Event()
    def change_target():
        started.set()
        api.module.select_target(sid, api.module.TargetInput(bbox=(65, 20, 115, 40)), api.user)
        finished.set()
    with api.module.event_guard():
        thread = Thread(target=change_target)
        thread.start()
        assert started.wait(1)
        assert not finished.wait(.05)
        assert api.module.verify_event(token, "51F12345", "user-a")["sourceEventId"] == token
    thread.join(2)
    assert finished.is_set()
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")


def test_confirmation_preserves_selected_target_provenance(api):
    sid = create(api)
    api.observations.append(observation("59A112345", (65, 20, 115, 40), confidence=.8))
    frame(api, sid, 1)
    api.module.select_target(sid, api.module.TargetInput(bbox=(65, 20, 115, 40)), api.user)
    response = confirm(api, sid, plateNumber="59A112345")
    assert response.status_code == 200, response.text
    event = api.module.verify_event(response.json()["sourceEventId"], "59A112345", "user-a")
    assert event["bbox"] == [65, 20, 115, 40]
    assert event["confidence"] == pytest.approx(.72)


def test_manual_and_correction_write_durable_audit(api, db, staff):
    from app.database import get_db
    from app.models import AuditLog
    from sqlalchemy import select
    api.user.id = staff.id
    api.client.app.dependency_overrides[get_db] = lambda: db
    manual = api.client.post("/api/v1/recognition/manual", json={
        "plateNumber": "51F-123.45", "mode": "ENTRY", "reason": "Camera disconnected"})
    assert manual.status_code == 200, manual.text
    event = api.module.verify_event(manual.json()["sourceEventId"], "51F12345", staff.id)
    assert event["manual"] is True
    assert event["reason"] == "Camera disconnected"
    audit = db.scalar(select(AuditLog).where(AuditLog.entity_id == event["sourceEventId"]))
    assert audit.action == "MANUAL_RECOGNITION"
    assert audit.details["reason"] == "Camera disconnected"
    sid = create(api)
    frame(api, sid, 1)
    corrected = confirm(api, sid, plateNumber="59A112345", reason="Staff checked the plate")
    assert corrected.status_code == 200, corrected.text
    audit = db.scalar(select(AuditLog).where(AuditLog.entity_id == corrected.json()["sourceEventId"]))
    assert audit.action == "RECOGNITION_CORRECTED"
    assert audit.details["plateNumber"] == "59A112345"


class _NoDb:
    def commit(self):
        pass


@pytest.fixture
def audited(api, monkeypatch):
    """Correction and manual paths audit and commit; the route test replaces both."""
    from app.database import get_db
    monkeypatch.setattr(api.module, "audit", lambda *args, **kwargs: None)
    api.client.app.dependency_overrides[get_db] = lambda: _NoDb()
    return api


def test_session_exposes_vehicle_hint_from_series(api):
    api.observations[:] = [observation("59X112345", (10, 10, 80, 60), lines=["59X1", "12345"])]
    sid = create(api)
    assert create_hint(api, sid) is None
    result = frame(api, sid, 1).json()
    assert result["vehicleHint"] == {"type": "MOTORBIKE", "source": "SERIES"}


def create_hint(api, sid):
    return api.client.get(f"/api/v1/recognition/sessions/{sid}").json()["vehicleHint"]


def test_session_without_plate_has_no_vehicle_hint(api):
    api.observations[:] = [observation("garbage", lines=["garbage"])]
    sid = create(api)
    assert frame(api, sid, 1).json()["vehicleHint"] is None


def test_target_selection_exposes_vehicle_hint(api):
    api.observations[:] = [
        observation("59X112345", (10, 20, 60, 40), lines=["59X1", "12345"]),
        observation("29A12345", (65, 20, 115, 40), lines=["29A", "12345"])]
    sid = create(api)
    assert frame(api, sid, 1).json()["vehicleHint"] is None
    response = api.client.post(f"/api/v1/recognition/sessions/{sid}/target",
                               json={"bbox": [65, 20, 115, 40]})
    assert response.json()["vehicleHint"] == {"type": "CAR", "source": "SERIES"}


def test_confirmation_prefers_vehicle_record(api, monkeypatch):
    monkeypatch.setattr(api.module, "_record_type", lambda db, plate: "CAR")
    api.observations[:] = [observation("59X112345", (10, 10, 80, 60), lines=["59X1", "12345"])]
    sid = create(api)
    frame(api, sid, 1)
    body = confirm(api, sid, plateNumber="59X112345").json()
    assert body["vehicleHint"] == {"type": "CAR", "source": "RECORD"}
    # A repeated confirmation returns the same identity and hint.
    assert confirm(api, sid, plateNumber="59X112345").json() == body


def test_confirmation_uses_series_hint_without_record(api):
    api.observations[:] = [observation("59X112345", (10, 10, 80, 60), lines=["59X1", "12345"])]
    sid = create(api)
    frame(api, sid, 1)
    assert confirm(api, sid, plateNumber="59X112345").json()["vehicleHint"] == {
        "type": "MOTORBIKE", "source": "SERIES"}


def test_corrected_plate_hint_ignores_stale_lines(audited):
    audited.observations[:] = [observation("59X112345", (0, 0, 120, 50), lines=["59X1", "12345"])]
    sid = create(audited)
    frame(audited, sid, 1)
    response = confirm(audited, sid, plateNumber="29A11234", reason="Staff checked the plate")
    assert response.status_code == 200, response.text
    assert response.json()["vehicleHint"] == {"type": "CAR", "source": "SERIES_SHAPE"}


def test_manual_confirmation_has_series_hint(audited):
    response = audited.client.post("/api/v1/recognition/manual", json={
        "plateNumber": "59X112345", "mode": "ENTRY", "reason": "Camera disconnected"})
    assert response.status_code == 200, response.text
    assert response.json()["vehicleHint"] == {"type": "MOTORBIKE", "source": "SERIES"}
    assert audited.module.verify_event(response.json()["sourceEventId"], "59X112345", "user-a")["manual"] is True


def test_single_remaining_line_is_not_used_as_top_line(api):
    api.observations[:] = [observation("59X112345", (10, 10, 80, 60), lines=["12345"])]
    sid = create(api)
    frame(api, sid, 1)
    hint = confirm(api, sid, plateNumber="59X112345").json()["vehicleHint"]
    assert hint == {"type": "MOTORBIKE", "source": "SERIES"}  # from plate string, not "12345"


def test_confirmation_gets_its_own_window_after_slow_correction(api):
    """Nhân viên mất gần hết 60 s (sửa biển, hỏi khách…); xác nhận xong vẫn phải còn đủ thời gian ghi nhận xe."""
    api.observations[:] = [observation(confidence=.95)]
    sid = create(api)
    frame(api, sid, 1)
    assert frame(api, sid, 2).json()["state"] == "READY"
    api.clock[0] += timedelta(seconds=55)
    token = confirm(api, sid).json()["sourceEventId"]
    api.clock[0] += timedelta(seconds=30)
    assert api.module.verify_event(token, "51F12345", "user-a")["plateNumber"] == "51F12345"
    api.clock[0] += timedelta(seconds=31)
    with pytest.raises(HTTPException):
        api.module.verify_event(token, "51F12345", "user-a")
