import os
from pathlib import Path
from uuid import uuid4

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


load_dotenv(Path(__file__).resolve().parents[1] / ".env.test")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-with-at-least-32-characters")


@pytest.fixture
def db(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("PostgreSQL integration requires TEST_DATABASE_URL (.env.test); SQLite is unsupported")
    from app import database
    from app import models  # noqa: F401
    schema = "test_" + uuid4().hex
    admin_engine = create_engine(url, connect_args={"connect_timeout": 3})
    try:
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    except Exception as exc:
        admin_engine.dispose()
        pytest.skip(f"PostgreSQL integration unavailable: {exc}")
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}", "connect_timeout": 3})
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", factory)
    database.init_db()
    try:
        with factory() as session:
            yield session
    finally:
        engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()


@pytest.fixture
def client(db):
    from app.main import app
    from app.database import get_db

    def test_db():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def staff(db):
    from app.auth import hash_password
    from app.models import User
    user = User(username="staff", password_hash=hash_password("StaffPassword123!"), role="STAFF")
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def admin(db):
    from app.auth import hash_password
    from app.models import User
    user = User(username="admin", password_hash=hash_password("AdminPassword123!"), role="ADMIN")
    db.add(user)
    db.commit()
    return user


def authenticated_client(db, user, password):
    from app.main import app
    client = TestClient(app)
    token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
    client.headers["X-CSRF-Token"] = token
    response = client.post("/api/v1/auth/login", json={"username": user.username, "password": password})
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
def staff_client(client, db, staff):
    with authenticated_client(db, staff, "StaffPassword123!") as authenticated:
        yield authenticated


@pytest.fixture
def admin_client(client, db, admin):
    with authenticated_client(db, admin, "AdminPassword123!") as authenticated:
        yield authenticated
