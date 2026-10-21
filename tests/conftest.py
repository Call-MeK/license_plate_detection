import os
from pathlib import Path
from uuid import uuid4

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker


load_dotenv(Path(__file__).resolve().parents[1] / ".env.test")
os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-with-at-least-32-characters")


@pytest.fixture
def db(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.fail("PostgreSQL tests require TEST_DATABASE_URL pointing to parking_test", pytrace=False)
    try:
        target = make_url(url)
        if target.drivername != "postgresql+psycopg" or target.database != "parking_test":
            raise ValueError
    except Exception:
        pytest.fail("Refusing test mutations: TEST_DATABASE_URL must use postgresql+psycopg and parking_test", pytrace=False)
    from app import database
    from app import models  # noqa: F401
    schema = "test_" + uuid4().hex
    admin_engine = create_engine(url, connect_args={"connect_timeout": 3}, hide_parameters=True)
    try:
        with admin_engine.begin() as connection:
            if connection.scalar(text("SELECT current_database()")) != "parking_test":
                pytest.fail("Refusing test mutations outside parking_test", pytrace=False)
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    except Exception:
        admin_engine.dispose()
        pytest.fail("PostgreSQL unavailable: check TEST_DATABASE_URL, service and schema permissions (details redacted)", pytrace=False)
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}", "connect_timeout": 3}, hide_parameters=True)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", factory)
    try:
        database.init_db()
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
