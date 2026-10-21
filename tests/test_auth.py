from sqlalchemy import select


def csrf(client):
    token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
    return {"X-CSRF-Token": token}


def test_wrong_password_rejected(client, staff):
    response = client.post("/api/v1/auth/login", json={"username": staff.username, "password": "wrong"}, headers=csrf(client))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_requires_csrf(client, staff):
    response = client.post("/api/v1/auth/login", json={"username": staff.username, "password": "StaffPassword123!"})
    assert response.status_code == 403


def test_login_cookie_me_and_logout_revokes_session(client, staff, db):
    from app.models import AuthSession
    headers = csrf(client)
    response = client.post("/api/v1/auth/login", json={"username": staff.username, "password": "StaffPassword123!"}, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"id": staff.id, "username": "staff", "role": "STAFF"}
    assert "httponly" in response.headers["set-cookie"].lower()
    token = client.cookies.get("access_token")
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert db.scalar(select(AuthSession)).revoked
    client.cookies.set("access_token", token)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_staff_cannot_manage_users(staff_client):
    assert staff_client.get("/api/v1/users").status_code == 403
    assert staff_client.post("/api/v1/users", json={"username": "new", "password": "Password123!", "role": "ADMIN"}).status_code == 403


def test_admin_manages_user_and_role_change_revokes_sessions(admin_client, staff_client, staff):
    response = admin_client.post("/api/v1/users", json={"username": "new-user", "password": "Password123!", "role": "STAFF"})
    assert response.status_code == 201
    assert "password" not in response.text
    response = admin_client.patch(f"/api/v1/users/{staff.id}", json={"active": False})
    assert response.status_code == 200
    assert staff_client.get("/api/v1/auth/me").status_code == 401
    items = admin_client.get("/api/v1/users").json()["items"]
    assert {item["username"] for item in items} == {"admin", "staff", "new-user"}


def test_password_change_checks_current_password_and_revokes_all_sessions(staff_client, staff):
    response = staff_client.post("/api/v1/auth/password", json={"currentPassword": "incorrect", "newPassword": "ChangedPassword123!"})
    assert response.status_code == 401
    response = staff_client.post("/api/v1/auth/password", json={"currentPassword": "StaffPassword123!", "newPassword": "ChangedPassword123!"})
    assert response.status_code == 200
    assert staff_client.get("/api/v1/auth/me").status_code == 401


def test_csrf_token_bound_to_authenticated_session(staff_client, client):
    token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
    staff_client.cookies.set("csrf_token", token, domain="testserver.local", path="/")
    response = staff_client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": token})
    assert response.status_code == 403


def test_expired_database_session_rejected(staff_client, db):
    from datetime import timedelta
    from app.database import utcnow
    from app.models import AuthSession
    session = db.scalar(select(AuthSession))
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert staff_client.get("/api/v1/auth/me").status_code == 401


def test_modified_jwt_signature_rejected(staff_client):
    token = staff_client.cookies.get("access_token")
    payload, signature = token.rsplit(".", 1)
    token = payload + "." + ("a" if signature[0] != "a" else "b") + signature[1:]
    staff_client.cookies.set("access_token", token, domain="testserver.local", path="/")
    assert staff_client.get("/api/v1/auth/me").status_code == 401


def test_password_audit_never_contains_secrets(admin_client, staff, db):
    from app.models import AuditLog
    response = admin_client.patch(f"/api/v1/users/{staff.id}", json={"password": "NewSecretPassword123!"})
    assert response.status_code == 200
    logs = db.scalars(select(AuditLog).where(AuditLog.action == "USER_UPDATED")).all()
    assert logs
    assert "NewSecretPassword123!" not in str([log.details for log in logs])


def test_duplicate_username_conflict(admin_client):
    response = admin_client.post("/api/v1/users", json={"username": "admin", "password": "Password123!", "role": "STAFF"})
    assert response.status_code == 409


def test_csrf_allows_safe_requests_without_token(db):
    from starlette.requests import Request
    from app.auth import csrf_protect
    csrf_protect(Request({"type": "http", "method": "GET", "path": "/api/v1/users", "headers": []}), db)


def test_authenticated_mutation_requires_csrf(staff_client):
    del staff_client.headers["X-CSRF-Token"]
    assert staff_client.post("/api/v1/auth/logout").status_code == 403


def test_last_active_admin_cannot_be_disabled_or_demoted(admin_client, admin):
    assert admin_client.patch(f"/api/v1/users/{admin.id}", json={"active": False}).status_code == 409
    assert admin_client.patch(f"/api/v1/users/{admin.id}", json={"role": "STAFF"}).status_code == 409


def test_admin_can_disable_another_admin_if_one_remains(admin_client):
    created = admin_client.post("/api/v1/users", json={"username": "second-admin", "password": "Password123!", "role": "ADMIN"}).json()
    assert admin_client.patch(f"/api/v1/users/{created['id']}", json={"active": False}).status_code == 200


def test_login_without_users_table_has_actionable_redacted_error(client, db, monkeypatch):
    from app import database
    from app.main import app
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    # A nonexistent search_path hides all application tables without deleting any.
    empty = create_engine(db.get_bind().url, connect_args={"options": "-csearch_path=missing_schema"})
    previous = app.dependency_overrides.pop(database.get_db)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(empty))
    try:
        with TestClient(app) as client:
            token = client.get("/api/v1/auth/csrf").json()["csrfToken"]
            response = client.post("/api/v1/auth/login", headers={"X-CSRF-Token": token},
                                   json={"username": "admin", "password": "private-password"})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "DATABASE_SCHEMA_REQUIRED"
        assert "private-password" not in response.text
    finally:
        app.dependency_overrides[database.get_db] = previous
        empty.dispose()


def test_login_commit_failure_does_not_return_success_or_cookie(client, db, staff):
    from app.database import get_db
    from app.main import app
    from sqlalchemy import text
    # Fail after login's flush, when its audit row is committed by the real dependency.
    db.execute(text("""
        CREATE FUNCTION reject_test_login() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'private database failure'; END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_test_login BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION reject_test_login();
    """))
    db.commit()
    previous = app.dependency_overrides.pop(get_db)
    try:
        response = client.post("/api/v1/auth/login", headers=csrf(client),
                               json={"username": staff.username, "password": "StaffPassword123!"})
        assert response.status_code == 503
        assert "access_token" not in response.headers.get("set-cookie", "")
        assert "private database failure" not in response.text
        with db.get_bind().connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM auth_sessions")) == 0
    finally:
        app.dependency_overrides[get_db] = previous
