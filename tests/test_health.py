from fastapi.testclient import TestClient

from app import main
import pytest


def test_health_ok():
    assert hasattr(main, "app"), "FastAPI application must be exposed"
    with TestClient(main.app) as client:
        response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_errors_use_contract():
    assert hasattr(main, "app"), "FastAPI application must be exposed"
    with TestClient(main.app) as client:
        response = client.get("/api/v1/not-found")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_startup_rejects_missing_persistent_secret(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        with TestClient(main.app):
            pass


def test_readiness_checks_real_postgres(db):
    with TestClient(main.app) as client:
        response = client.get("/api/v1/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_database_outage_is_redacted_and_health_still_works(monkeypatch, caplog):
    from app import database
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    broken = create_engine("postgresql+psycopg://invalid:do-not-leak@127.0.0.1:1/parking",
                           connect_args={"connect_timeout": 1}, hide_parameters=True)
    monkeypatch.setattr(database, "engine", broken)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(broken))
    try:
        with TestClient(main.app) as client:
            assert client.get("/api/v1/health").json() == {"status": "ok"}
            ready = client.get("/api/v1/ready")
            token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
            login = client.post("/api/v1/auth/login", headers={"X-CSRF-Token": token},
                                json={"username": "admin", "password": "private-password"})
        for response in (ready, login):
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
            assert "do-not-leak" not in response.text
        assert "do-not-leak" not in caplog.text
        assert "private-password" not in caplog.text
        assert token not in caplog.text
    finally:
        broken.dispose()
