from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_summary_endpoint_filters_may():
    response = client.get("/api/summary", params={"period": "2026-05"})
    assert response.status_code == 200
    assert response.json()["orders"] == 213


def test_invalid_period_has_informative_error():
    response = client.get("/api/summary", params={"period": "2025-01"})
    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_PERIOD"


def test_route_scenario_endpoint():
    response = client.get("/api/route-scenario", params={"period": "2026-06"})
    assert response.status_code == 200
    assert response.json()["orders"] == 17
