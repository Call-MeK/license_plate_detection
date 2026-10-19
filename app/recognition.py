"""Bounded, single-worker recognition observations and staff confirmation."""
from collections import Counter, deque
from contextlib import contextmanager
from datetime import timedelta
from io import BytesIO
import math
import threading
from typing import Literal
from uuid import uuid4

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.auth import audit, csrf_protect, current_user
from app.database import get_db, utcnow
from src import config
from src.pipeline import process_frame
from src.postprocess import clean_plate, is_valid

router = APIRouter(prefix="/recognition", tags=["recognition"])
_lock = threading.RLock()
_sessions = {}
_events = {}
MAX_FRAME_BYTES = 2 * 1024 * 1024
MAX_SESSIONS = 128
MAX_EVENTS = 256


@contextmanager
def event_guard():
    """Parking holds this guard through verification AND transaction commit."""
    with _lock:
        yield


def fail(status, code, message):
    raise HTTPException(status, {"code": code, "message": message})


class SessionInput(BaseModel):
    mode: Literal["ENTRY", "EXIT"]


class ConfirmationInput(BaseModel):
    plateNumber: str = Field(min_length=1, max_length=24)
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("plateNumber")
    @classmethod
    def plate(cls, value):
        value = clean_plate(value)
        if not is_valid(value):
            raise ValueError("Invalid plate number")
        return value


class ManualInput(ConfirmationInput):
    mode: Literal["ENTRY", "EXIT"]
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def required_reason(cls, value):
        if not value.strip():
            raise ValueError("A reason is required")
        return value.strip()


class TargetInput(BaseModel):
    bbox: tuple[int, int, int, int]


def _invalidate(session_id):
    for key in list(_events):
        if _events[key].get("sessionId") == session_id:
            del _events[key]


def _prune():
    now = utcnow()
    for key in list(_sessions):
        if _sessions[key]["expiresAt"] <= now:
            _invalidate(key)
            del _sessions[key]
    for key in list(_events):
        if _events[key]["expiresAt"] <= now:
            del _events[key]


def _owned(session_id, user):
    session = _sessions.get(session_id)
    if session is None or session["actorId"] != str(user.id):
        fail(404, "SESSION_NOT_FOUND", "Recognition session not found")
    if session["expiresAt"] <= utcnow():
        _invalidate(session_id)
        fail(410, "SESSION_EXPIRED", "Start a new recognition session")
    return session


def _dto(session):
    return {key: session[key] for key in (
        "id", "mode", "state", "status", "plateNumber", "candidates",
        "needsTarget", "sequence", "expiresAt", "stub")}


def _ready(session):
    if session["state"] == "COLLECTING":
        session["state"] = "READY"
        session["expiresAt"] = utcnow() + timedelta(seconds=60)


def _overlap(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - intersection
    return intersection / union if union > 0 else 0


def _vote(session, candidate):
    if candidate and is_valid(candidate["plateNumber"]):
        session["votes"].append((candidate["plateNumber"], candidate["confidence"]))
    else:
        session["votes"].append(("", 0))
    weights = Counter()
    counts = Counter()
    for plate, confidence in session["votes"]:
        if plate:
            weights[plate] += confidence
            counts[plate] += 1
    session["plateNumber"] = weights.most_common(1)[0][0] if weights else None
    session["status"] = "UNCERTAIN"
    if weights:
        plate = session["plateNumber"]
        # shortcut: fixed vote thresholds need calibration against labeled camera footage.
        if counts[plate] >= 3 and weights[plate] / counts[plate] >= .5 and weights[plate] >= .7 * sum(weights.values()):
            session["status"] = "STABLE"
            _ready(session)


def _confirmation(event):
    return {key: event[key] for key in ("sourceEventId", "plateNumber", "expiresAt")}


def _new_event(user, plate, mode, expires, *, manual=False, reason=None, session_id=None):
    _prune()
    if len(_events) >= MAX_EVENTS:
        fail(429, "RECOGNITION_CAPACITY", "Too many live confirmations; wait for expiry")
    return {"sourceEventId": str(uuid4()), "plateNumber": plate, "actorId": str(user.id),
            "mode": mode, "manual": manual, "reason": reason,
            "expiresAt": expires, "sessionId": session_id, "bbox": None, "confidence": None}


def verify_event(source_event_id, plate_number, actor_id, mode=None):
    with event_guard():
        event = _events.get(source_event_id)
        if event is None:
            fail(409, "INVALID_RECOGNITION", "Confirm a current observation first")
        if event["expiresAt"] <= utcnow():
            fail(410, "RECOGNITION_EXPIRED", "The confirmed observation has expired")
        if event["actorId"] != str(actor_id) or event["plateNumber"] != plate_number or (mode and event["mode"] != mode):
            fail(409, "INVALID_RECOGNITION", "The confirmed observation does not match")
        verified = {key: event[key] for key in (
            "sourceEventId", "plateNumber", "actorId", "mode", "manual", "reason", "expiresAt")}
        verified["bbox"] = list(event["bbox"]) if event["bbox"] is not None else None
        verified["confidence"] = event["confidence"]
        return verified


@router.post("/sessions", dependencies=[Depends(csrf_protect)])
def create_session(body: SessionInput, user=Depends(current_user)):
    with event_guard():
        _prune()
        for key in list(_sessions):
            if _sessions[key]["actorId"] == str(user.id):
                _invalidate(key)
                del _sessions[key]
        if len(_sessions) >= MAX_SESSIONS:
            fail(429, "RECOGNITION_CAPACITY", "Too many live recognition sessions")
        session = {"id": str(uuid4()), "actorId": str(user.id), "mode": body.mode,
                   "state": "COLLECTING", "status": "UNCERTAIN", "plateNumber": None,
                   "candidates": [], "needsTarget": False, "sequence": 0,
                   "expiresAt": utcnow() + timedelta(seconds=15), "stub": config.USE_STUB,
                   "votes": deque(maxlen=20), "target": None, "lastBox": None}
        _sessions[session["id"]] = session
        return _dto(session)


@router.get("/sessions/{session_id}")
def get_session(session_id: str, user=Depends(current_user)):
    with event_guard():
        return _dto(_owned(session_id, user))


@router.delete("/sessions/{session_id}", dependencies=[Depends(csrf_protect)])
def delete_session(session_id: str, user=Depends(current_user)):
    with event_guard():
        _owned(session_id, user)
        _invalidate(session_id)
        del _sessions[session_id]
        return {"ok": True}


@router.post("/sessions/{session_id}/frames", dependencies=[Depends(csrf_protect)])
def upload_frame(session_id: str, frame: UploadFile = File(...), sequence: int = Form(..., ge=1),
                 user=Depends(current_user)):
    with event_guard():
        session = _owned(session_id, user)
        if sequence != session["sequence"] + 1:
            fail(409, "FRAME_SEQUENCE", "Frames must be submitted sequentially")
        data = frame.file.read(MAX_FRAME_BYTES + 1)
        if len(data) > MAX_FRAME_BYTES:
            fail(413, "FRAME_TOO_LARGE", "Frame exceeds 2 MiB")
        try:
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
                if width > 1920 or height > 1080 or width * height > 1920 * 1080:
                    fail(413, "FRAME_TOO_LARGE", "Frame exceeds 1920 by 1080")
                if image.format not in ("JPEG", "PNG"):
                    fail(422, "INVALID_FRAME", "Only JPEG and PNG are supported")
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            fail(422, "INVALID_FRAME", "The uploaded frame is not a valid image")
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            fail(422, "INVALID_FRAME", "The uploaded frame cannot be decoded")
        _invalidate(session_id)
        session["sequence"] = sequence
        try:
            _, observations = process_frame(image)
        except Exception:
            session["votes"].clear()
            session.update(status="UNCERTAIN", plateNumber=None, candidates=[], needsTarget=False)
            fail(503, "AI_UNAVAILABLE", "Recognition failed; retry or use manual entry with a reason")
        if session["expiresAt"] <= utcnow():
            fail(410, "SESSION_EXPIRED", "Recognition session expired during inference")
        # Model output is bounded before retaining it in memory.
        candidates = []
        for item in observations[:16]:
            confidence = float(item["ocr_confidence"]) * float(item["detector_confidence"])
            if not math.isfinite(confidence):
                confidence = 0.0
            candidates.append({"plateNumber": clean_plate(item["plate"]),
                               "bbox": list(item["bbox"]), "confidence": max(0., min(1., confidence))})
        session["candidates"] = candidates
        candidate = None
        if session["target"] is not None:
            matching = [c for c in candidates if _overlap(c["bbox"], session["target"]) >= .5]
            if len(matching) == 1:
                candidate = matching[0]
                session["target"] = candidate["bbox"]
            else:
                session["target"] = None
                session["votes"].clear()
        session["needsTarget"] = len(candidates) > 1 and session["target"] is None
        if not session["needsTarget"] and candidate is None and len(candidates) == 1:
            candidate = candidates[0]
        if candidate and session["lastBox"] and _overlap(candidate["bbox"], session["lastBox"]) < .5:
            session["votes"].clear()
        session["lastBox"] = candidate["bbox"] if candidate else None
        if session["needsTarget"]:
            session["votes"].clear()
        _vote(session, candidate)
        return _dto(session)


@router.post("/sessions/{session_id}/target", dependencies=[Depends(csrf_protect)])
def select_target(session_id: str, body: TargetInput, user=Depends(current_user)):
    with event_guard():
        session = _owned(session_id, user)
        box = list(body.bbox)
        selected = next((c for c in session["candidates"] if c["bbox"] == box), None)
        if selected is None:
            fail(422, "INVALID_TARGET", "Select a bounding box from the current frame")
        _invalidate(session_id)
        session.update(target=box, lastBox=box, needsTarget=False, status="UNCERTAIN",
                       plateNumber=selected["plateNumber"] if is_valid(selected["plateNumber"]) else None)
        session["votes"].clear()
        return _dto(session)


@router.post("/sessions/{session_id}/confirm", dependencies=[Depends(csrf_protect)])
def confirm_session(session_id: str, body: ConfirmationInput, user=Depends(current_user), db: Session = Depends(get_db)):
    with event_guard():
        session = _owned(session_id, user)
        if session["needsTarget"] or not session["candidates"]:
            fail(409, "TARGET_REQUIRED", "Observe a plate and select its target first")
        correction = body.plateNumber != session["plateNumber"]
        reason = (body.reason or "").strip() or None
        if correction and not reason:
            fail(422, "REASON_REQUIRED", "A plate correction requires a reason")
        _ready(session)
        # Repeated confirmation of the same observation keeps a stable identity.
        for event in _events.values():
            if event["sessionId"] == session_id and event["plateNumber"] == body.plateNumber and event["reason"] == reason:
                return _confirmation(event)
        _invalidate(session_id)
        event = _new_event(user, body.plateNumber, session["mode"], session["expiresAt"],
                           reason=reason, session_id=session_id)
        candidate = next((c for c in session["candidates"]
                          if c["bbox"] == (session["target"] or session["lastBox"])), None)
        if candidate is not None:
            event["bbox"] = list(candidate["bbox"])
            event["confidence"] = candidate["confidence"]
        if correction:
            audit(db, str(user.id), "RECOGNITION_CORRECTED", "recognition_event", event["sourceEventId"],
                  {"plateNumber": body.plateNumber, "reason": reason, "mode": session["mode"]})
            db.commit()
        _events[event["sourceEventId"]] = event
        return _confirmation(event)


@router.post("/manual", dependencies=[Depends(csrf_protect)])
def manual_confirmation(body: ManualInput, user=Depends(current_user), db: Session = Depends(get_db)):
    with event_guard():
        event = _new_event(user, body.plateNumber, body.mode, utcnow() + timedelta(seconds=60),
                           manual=True, reason=body.reason)
        audit(db, str(user.id), "MANUAL_RECOGNITION", "recognition_event", event["sourceEventId"],
              {"plateNumber": body.plateNumber, "reason": body.reason, "mode": body.mode})
        db.commit()
        _events[event["sourceEventId"]] = event
        return _confirmation(event)
