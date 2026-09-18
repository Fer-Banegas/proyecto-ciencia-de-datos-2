from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.data_service import LogisticsDataService


client = TestClient(app)


def test_default_scenario_reconciles_with_workbook():
    source = client.get("/api/simulator/source").json()
    assert source["orders"] == 230
    result = client.post("/api/simulator/calculate", json=source)
    assert result.status_code == 200
    body = result.json()
    assert body["kilometers"] == {"before": 16284.81, "after": 13090.07, "saving": 3194.74, "percent": 19.62}
    assert body["fuel_cost"]["before"] == 62242.71
    assert body["fuel_cost"]["after"] == 48250.31
    assert body["vehicles"]["before"] == 8
    assert body["vehicles"]["after"] == 4
    reference = LogisticsDataService().route_scenario("all")
    assert body["reference"]["kilometers"]["after"] == reference["proposed_km"]
    assert body["reference"]["fuel_cost"]["after"] == reference["proposed_cost"]
    assert body["salary"]["before"] == reference["base_salary_period_assumed"]
    assert body["total_cost"]["after"] == reference["total_cost_proposed_assumed"]
    assert sum(zone["orders"] for zone in body["zones"]) == 230
    report = client.post("/api/simulator/report", json=source)
    assert report.status_code == 200
    assert report.headers["content-type"] == "application/pdf"
    assert report.content.startswith(b"%PDF-")


def test_original_upload_and_invalid_upload():
    original = Path(__file__).resolve().parents[2] / "data" / "Distribuidora_Atlantida_Express.xlsx"
    response = client.post("/api/simulator/import", content=original.read_bytes(), headers={"X-Filename": original.name})
    assert response.status_code == 200
    source = response.json()
    assert source["format"] == "Original normalizado"
    assert source["orders"] == 230
    assert client.post("/api/simulator/calculate", json=source).json()["kilometers"]["before"] == 16284.81
    invalid = client.post("/api/simulator/import", content=b"not an xlsx", headers={"X-Filename": "blank.xlsx"})
    assert invalid.status_code == 422


def test_scenario_validation_and_worse_result():
    source = client.get("/api/simulator/source").json()
    source["zones"][0]["municipalities"] = ["La Ceiba"]
    missing = client.post("/api/simulator/calculate", json=source)
    assert missing.status_code == 422
    assert missing.json()["code"] == "UNCOVERED_CITY"
    source = client.get("/api/simulator/source").json()
    source["zones"][1]["driver_id"] = source["zones"][0]["driver_id"]
    duplicate = client.post("/api/simulator/calculate", json=source)
    assert duplicate.status_code == 422
    assert duplicate.json()["code"] == "DUPLICATE_RESOURCE"
    source = client.get("/api/simulator/source").json()
    source["fuel_price"] = 100
    worse = client.post("/api/simulator/calculate", json=source).json()
    assert worse["fuel_cost"]["saving"] < 0
    assert worse["fuel_cost"]["after"] > worse["reference"]["fuel_cost"]["after"]
    assert worse["total_cost"]["after"] > worse["reference"]["total_cost"]["after"]
    assert any("precio" in note.lower() for note in worse["notes"])


def test_reassignment_recalculates_and_report_uses_same_scenario():
    source = client.get("/api/simulator/source").json()
    original = client.post("/api/simulator/calculate", json=source).json()
    source["zones"][3]["driver_id"] = "R006"
    source["zones"][3]["vehicle_id"] = "V006"
    changed = client.post("/api/simulator/calculate", json=source).json()
    assert changed["kilometers"]["before"] == original["kilometers"]["before"]
    assert changed["fuel_cost"]["after"] != original["fuel_cost"]["after"]
    assert changed["reference"] == original["reference"]
    assert changed["zones"][3]["driver"] == "Kevin Flores"
    pdf = client.post("/api/simulator/report", json=source)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")


def test_fleet_reserve_and_inactive_are_not_assigned_or_counted_as_savings():
    source = client.get("/api/simulator/source").json()
    source["vehicle_states"] = {"V003": "reserve", "V008": "inactive"}
    response = client.post("/api/simulator/calculate", json=source)
    assert response.status_code == 200
    result = response.json()
    assert result["fleet_status"] == {"in_route": ["V001", "V002", "V004", "V007"], "reserve": ["V003"], "inactive": ["V008"]}
    assert result["fuel_cost"]["after"] == 48250.31
    assert result["reference"]["vehicles"]["after"] == 4
    source["vehicle_states"]["V001"] = "reserve"
    invalid = client.post("/api/simulator/calculate", json=source)
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "UNAVAILABLE_VEHICLE"


def test_three_zone_scenario_from_review_reconciles():
    source = client.get("/api/simulator/source").json()
    source["zones"] = [
        {"id": "Z1", "municipalities": ["La Ceiba", "Jutiapa", "El Porvenir"], "driver_id": "R001", "vehicle_id": "V001"},
        {"id": "Z2", "municipalities": ["San Francisco", "La Masica", "Esparta"], "driver_id": "R004", "vehicle_id": "V004"},
        {"id": "Z3", "municipalities": ["Arizona", "Tela"], "driver_id": "R007", "vehicle_id": "V007"},
    ]
    source["drivers"] = [person for person in source["drivers"] if person["id"] in {"R001", "R004", "R007"}]
    source["vehicle_states"] = {"V003": "reserve", "V005": "inactive", "V006": "inactive", "V008": "inactive"}
    result = client.post("/api/simulator/calculate", json=source).json()
    assert result["orders"] == sum(zone["orders"] for zone in result["zones"]) == 230
    assert result["kilometers"] == {"before": 16284.81, "after": 12382.07, "saving": 3902.74, "percent": 23.97}
    assert result["fuel_cost"] == {"before": 62242.71, "after": 45713.04, "saving": 16529.67, "percent": 26.56}
    assert result["routes"]["after"] == 93
    assert result["salary"]["after"] == 84600
    assert result["total_cost"]["after"] == round(result["fuel_cost"]["after"] + result["salary"]["after"], 2) == 130313.04
    assert round(sum(zone["after_km"] for zone in result["zones"]), 2) == result["kilometers"]["after"]
    assert round(sum(zone["after_cost"] for zone in result["zones"]), 2) == result["fuel_cost"]["after"]
    assert result["warnings"] == []
    assert client.post("/api/simulator/report", json=source).content.startswith(b"%PDF-")
