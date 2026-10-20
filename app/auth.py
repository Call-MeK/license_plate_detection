import hashlib
import hmac
import os
import secrets
from datetime import timedelta
from typing import Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.models import AuditLog, AuthSession, User


router = APIRouter(prefix="/api/v1")
password_hasher = PasswordHasher()
dummy_hash = password_hasher.hash(secrets.token_urlsafe(32))
SESSION_SECONDS = 8 * 60 * 60


def secret():
    value = os.getenv("JWT_SECRET", "")
    if len(value) < 32:
        raise RuntimeError("Set JWT_SECRET to a persistent random value of at least 32 characters")
    return value


def fail(status, code, message):
    raise HTTPException(status, detail={"code": code, "message": message})


def hash_password(password):
    return password_hasher.hash(password)


def password_matches(encoded, password):
    try:
        return password_hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def audit(db, actor_id, action, entity_type, entity_id, details=None):
    log = AuditLog(actor_id=actor_id, action=action, entity_type=entity_type,
                   entity_id=str(entity_id), details=details or {})
    db.add(log)
    return log


def user_dto(user):
    return {"id": user.id, "username": user.username, "role": user.role}


def auth_session(request, db):
    token = request.cookies.get("access_token")
    if not token:
        fail(401, "UNAUTHENTICATED", "Sign in to continue")
    try:
        claims = jwt.decode(token, secret(), algorithms=["HS256"], audience="parking-api",
                            issuer="parking-local", options={"require": ["exp", "iat", "sub", "sid"]})
        session = db.get(AuthSession, claims["sid"])
        if not session or session.revoked or session.expires_at <= utcnow() or session.user_id != claims["sub"]:
            fail(401, "UNAUTHENTICATED", "Session expired or revoked")
    except jwt.InvalidTokenError:
        fail(401, "UNAUTHENTICATED", "Invalid session")
    return session


def current_user(request: Request, db: Session = Depends(get_db)):
    session = auth_session(request, db)
    user = db.get(User, session.user_id)
    if not user or not user.active:
        fail(401, "UNAUTHENTICATED", "Account inactive")
    return user


def admin_user(user: User = Depends(current_user)):
    if user.role != "ADMIN":
        fail(403, "FORBIDDEN", "Administrator role required")
    return user


def csrf_signature(nonce):
    return hmac.new(secret().encode(), nonce.encode(), hashlib.sha256).hexdigest()


def valid_csrf(token):
    if not token or "." not in token:
        return False
    nonce, signature = token.rsplit(".", 1)
    return bool(nonce) and hmac.compare_digest(signature, csrf_signature(nonce))


def csrf_protect(request: Request, db: Session = Depends(get_db)):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    token = request.cookies.get("csrf_token", "")
    header = request.headers.get("X-CSRF-Token", "")
    if not valid_csrf(token) or not hmac.compare_digest(token, header):
        fail(403, "CSRF_INVALID", "Refresh the page and retry with its CSRF token")
    if request.cookies.get("access_token"):
        try:
            session = auth_session(request, db)
        except HTTPException:
            if request.url.path != "/api/v1/auth/login":
                raise
        else:
            if not hmac.compare_digest(session.csrf_token, token):
                fail(403, "CSRF_INVALID", "CSRF token does not belong to this session")


def cookie_options():
    return {"secure": os.getenv("COOKIE_SECURE", "false").lower() == "true", "samesite": "strict", "path": "/"}


@router.get("/auth/csrf")
def csrf(request: Request, response: Response, db: Session = Depends(get_db)):
    token = None
    if request.cookies.get("access_token"):
        try:
            token = auth_session(request, db).csrf_token
        except HTTPException:
            pass
    if not token:
        nonce = secrets.token_urlsafe(32)
        token = nonce + "." + csrf_signature(nonce)
    response.set_cookie("csrf_token", token, max_age=SESSION_SECONDS, httponly=True, **cookie_options())
    return {"csrfToken": token}


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


@router.post("/auth/login", dependencies=[Depends(csrf_protect)])
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username))
    matches = password_matches(user.password_hash if user else dummy_hash, body.password)
    if not user or not matches or not user.active:
        fail(401, "INVALID_CREDENTIALS", "Invalid username or password")
    now = utcnow()
    session = AuthSession(user_id=user.id, expires_at=now + timedelta(seconds=SESSION_SECONDS),
                          csrf_token=request.cookies["csrf_token"])
    db.add(session)
    db.flush()
    token = jwt.encode({"sub": user.id, "sid": session.id, "iat": now, "exp": session.expires_at,
                        "iss": "parking-local", "aud": "parking-api"}, secret(), algorithm="HS256")
    response.set_cookie("access_token", token, max_age=SESSION_SECONDS, httponly=True, **cookie_options())
    audit(db, user.id, "LOGIN", "User", user.id)
    return user_dto(user)


@router.get("/auth/me")
def me(user: User = Depends(current_user)):
    return user_dto(user)


@router.post("/auth/logout", dependencies=[Depends(csrf_protect)])
def logout(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    auth_session(request, db).revoked = True
    response.delete_cookie("access_token", **cookie_options())
    audit(db, user.id, "LOGOUT", "User", user.id)
    return {"ok": True}


class PasswordBody(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=1024)
    newPassword: str = Field(min_length=12, max_length=1024)


@router.post("/auth/password", dependencies=[Depends(csrf_protect)])
def change_password(body: PasswordBody, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not password_matches(user.password_hash, body.currentPassword):
        fail(401, "INVALID_CREDENTIALS", "Current password is incorrect")
    user.password_hash = hash_password(body.newPassword)
    db.execute(update(AuthSession).where(AuthSession.user_id == user.id).values(revoked=True))
    audit(db, user.id, "PASSWORD_CHANGED", "User", user.id)
    response.delete_cookie("access_token", **cookie_options())
    return {"ok": True}


class CreateUserBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=1024)
    role: Literal["ADMIN", "STAFF"]


class UpdateUserBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["ADMIN", "STAFF"] | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=12, max_length=1024)


@router.get("/users")
def users(page: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
          user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).order_by(User.username).offset((page - 1) * pageSize).limit(pageSize)).all()
    return {"items": [{**user_dto(row), "active": row.active} for row in rows],
            "total": db.scalar(select(func.count()).select_from(User)), "page": page, "pageSize": pageSize}


@router.post("/users", status_code=201, dependencies=[Depends(csrf_protect)])
def create_user(body: CreateUserBody, actor: User = Depends(admin_user), db: Session = Depends(get_db)):
    db.execute(text("SELECT pg_advisory_xact_lock(81001)"))
    if db.scalar(select(User).where(User.username == body.username)):
        fail(409, "USERNAME_EXISTS", "Username already exists")
    user = User(username=body.username, password_hash=hash_password(body.password), role=body.role)
    db.add(user)
    db.flush()
    audit(db, actor.id, "USER_CREATED", "User", user.id, {"username": user.username, "role": user.role})
    return {**user_dto(user), "active": user.active}


@router.patch("/users/{user_id}", dependencies=[Depends(csrf_protect)])
def update_user(user_id: str, body: UpdateUserBody, actor: User = Depends(admin_user), db: Session = Depends(get_db)):
    db.execute(text("SELECT pg_advisory_xact_lock(81001)"))
    user = db.get(User, user_id, populate_existing=True)
    if not user:
        fail(404, "NOT_FOUND", "User not found")
    changes = body.model_dump(exclude_unset=True)
    if not changes or any(value is None for value in changes.values()):
        fail(422, "INVALID_REQUEST", "Provide at least one non-null user change")
    if user.active and user.role == "ADMIN" and (changes.get("active") is False or changes.get("role", "ADMIN") != "ADMIN"):
        count = db.scalar(select(func.count()).select_from(User).where(User.role == "ADMIN", User.active.is_(True)))
        if count == 1:
            fail(409, "LAST_ADMIN", "Keep at least one active administrator")
    for name, value in changes.items():
        if name == "password":
            user.password_hash = hash_password(value)
        else:
            setattr(user, name, value)
    db.execute(update(AuthSession).where(AuthSession.user_id == user.id).values(revoked=True))
    audit(db, actor.id, "USER_UPDATED", "User", user.id,
          {name: value for name, value in changes.items() if name != "password"} | {"passwordChanged": "password" in changes})
    return {**user_dto(user), "active": user.active}
