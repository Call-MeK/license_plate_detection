from fastapi.testclient import TestClient

from app import main
import pytest
from unittest.mock import Mock


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


def test_startup_warms_up_models(monkeypatch):
    warm_up = Mock()
    monkeypatch.setattr(main, "warm_up", warm_up)
    with TestClient(main.app):
        pass
    warm_up.assert_called_once_with()


def test_startup_survives_warm_up_failure(monkeypatch):
    warm_up = Mock(side_effect=FileNotFoundError("missing model"))
    monkeypatch.setattr(main, "warm_up", warm_up)
    with TestClient(main.app) as client:
        response = client.get("/api/v1/health")
    warm_up.assert_called_once_with()
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
