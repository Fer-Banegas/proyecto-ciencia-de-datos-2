from app.data_service import LogisticsDataService


def test_summary_reconciles_periods():
    service = LogisticsDataService()
    total = service.summary("all")
    may = service.summary("2026-05")
    june = service.summary("2026-06")

    assert total["orders"] == may["orders"] + june["orders"]
    assert total["orders"] == 230
    assert may["orders"] == 213
    assert june["orders"] == 17


def test_quality_reconciles_route_calculations():
    quality = LogisticsDataService().quality()
    assert quality["duplicate_orders"] == 0
    assert quality["route_differences"]["cost"] == 0
    assert quality["route_differences"]["distance"] == 0
    assert quality["route_differences"]["time"] == 0


def test_route_scenario_reconciles_orders_and_distance():
    service = LogisticsDataService()
    scenario = service.route_scenario("all")
    assert scenario["orders"] == service.summary("all")["orders"]
    assert round(scenario["actual_km"] - scenario["proposed_km"], 2) == scenario["saving_km"]
    assert scenario["routes_improved"] > 0
    assert scenario["base_routes"] == 151
    assert scenario["routes"] == 109
    assert scenario["base_drivers"] == 8
    assert scenario["proposed_drivers"] == 4
    assert len(scenario["pairs"]) == 4
    assert sum(pair["orders"] for pair in scenario["pairs"]) == 230
    assert round(scenario["actual_cost"] - scenario["proposed_cost"], 2) == scenario["saving_cost"]
    assert round(scenario["base_salary_period_assumed"] - scenario["proposed_salary_period_assumed"], 2) == scenario["salary_saving_period_assumed"]
    assert round(scenario["total_cost_base_assumed"] - scenario["total_cost_proposed_assumed"], 2) == scenario["total_saving_assumed"]
    assert round(scenario["saving_cost"] + scenario["salary_saving_period_assumed"], 2) == scenario["total_saving_assumed"]
    assert scenario["salary_month_equivalents"] == round(1 + 17 / 30, 4)
    assert scenario["days_over_capacity"] == 0
    assert scenario["days_over_shift"] == 0


def test_salary_proration_follows_selected_period():
    service = LogisticsDataService()
    may = service.route_scenario("2026-05")
    june = service.route_scenario("2026-06")
    assert may["salary_month_equivalents"] == 1
    assert june["salary_month_equivalents"] == round(17 / 30, 4)
    assert may["salary_saving_period_assumed"] == 72000
    assert june["salary_saving_period_assumed"] == 40800


def test_municipalities_match_total_orders():
    service = LogisticsDataService()
    municipalities = service.municipalities("all")
    assert sum(item["orders"] for item in municipalities) == 230
