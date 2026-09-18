from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .config import DEFAULT_DATASET
from .errors import DatasetError


REQUIRED_SHEETS = {
    "Pedidos": {
        "id_pedido", "fecha_entrega", "ciudad", "nombre_repartidor",
        "distancia_base_asignada_km", "costo_combustible_base_L", "estado_entrega", "valor_pedido",
    },
    "Rutas_Base": {
        "distancia_base_km", "distancia_reordenada_local_km", "ahorro_local_km",
        "costo_base_L", "costo_reordenado_local_L", "ahorro_local_costo_L",
        "tiempo_base_min", "tiempo_reordenado_local_min", "ahorro_local_tiempo_min",
    },
    "Rutas_Diarias": {
        "zona_propuesta", "fecha_entrega", "total_pedidos", "cantidad_rutas_base",
        "distancia_actual_km", "distancia_optimizada_km", "ahorro_km",
        "costo_actual", "costo_optimizado", "ahorro_costo",
        "cumple_capacidad", "cumple_jornada_8h",
    },
    "Rutas_Comparacion": {"zona_propuesta", "distancia_actual_km", "distancia_optimizada_km", "ahorro_km"},
}


def _number(value: Any, decimals: int = 2) -> float:
    return round(float(value), decimals)


@dataclass
class DatasetSnapshot:
    path: Path
    modified_at: float
    sheets: dict[str, pd.DataFrame]


class LogisticsDataService:
    def __init__(self, dataset_path: Path = DEFAULT_DATASET) -> None:
        self.dataset_path = dataset_path
        self._snapshot: DatasetSnapshot | None = None

    def _load(self) -> DatasetSnapshot:
        if not self.dataset_path.exists():
            raise DatasetError(
                "No se encontró el archivo Excel configurado.",
                "DATASET_NOT_FOUND",
            )

        modified_at = self.dataset_path.stat().st_mtime
        if self._snapshot and self._snapshot.modified_at == modified_at:
            return self._snapshot

        try:
            workbook = pd.ExcelFile(self.dataset_path)
            missing_sheets = set(REQUIRED_SHEETS) - set(workbook.sheet_names)
            if missing_sheets:
                raise DatasetError(
                    f"Faltan hojas obligatorias: {', '.join(sorted(missing_sheets))}.",
                    "MISSING_SHEETS",
                )

            sheets = {
                sheet: pd.read_excel(self.dataset_path, sheet_name=sheet)
                for sheet in workbook.sheet_names
            }
        except DatasetError:
            raise
        except Exception as exc:
            raise DatasetError(
                "El archivo no pudo leerse. Verifica que sea un Excel válido.",
                "INVALID_DATASET",
            ) from exc

        for sheet, columns in REQUIRED_SHEETS.items():
            missing = columns - set(sheets[sheet].columns)
            if missing:
                raise DatasetError(
                    f"La hoja {sheet} no contiene: {', '.join(sorted(missing))}.",
                    "MISSING_COLUMNS",
                )

        pedidos = sheets["Pedidos"].copy()
        pedidos["fecha_entrega"] = pd.to_datetime(
            pedidos["fecha_entrega"], errors="coerce"
        )
        sheets["Pedidos"] = pedidos
        self._snapshot = DatasetSnapshot(self.dataset_path, modified_at, sheets)
        return self._snapshot

    def periods(self) -> list[str]:
        pedidos = self._load().sheets["Pedidos"]
        values = pedidos["fecha_entrega"].dropna().dt.to_period("M").astype(str)
        return sorted(values.unique().tolist())

    def _orders(self, period: str = "all") -> pd.DataFrame:
        pedidos = self._load().sheets["Pedidos"].copy()
        if period == "all":
            return pedidos
        if period not in self.periods():
            raise DatasetError(
                f"El periodo {period} no existe en el conjunto de datos.",
                "INVALID_PERIOD",
            )
        mask = pedidos["fecha_entrega"].dt.to_period("M").astype(str) == period
        return pedidos.loc[mask].copy()

    def metadata(self) -> dict[str, Any]:
        snapshot = self._load()
        pedidos = snapshot.sheets["Pedidos"]
        return {
            "dataset": snapshot.path.name,
            "sheets": list(snapshot.sheets.keys()),
            "periods": self.periods(),
            "date_min": pedidos["fecha_entrega"].min().isoformat(),
            "date_max": pedidos["fecha_entrega"].max().isoformat(),
        }

    def summary(self, period: str = "all") -> dict[str, Any]:
        pedidos = self._orders(period)
        status = pedidos["estado_entrega"].value_counts().to_dict()
        delivered = int(status.get("Entregado", 0))
        delayed = int(status.get("Retrasado", 0))
        total = int(len(pedidos))
        return {
            "period": period,
            "orders": total,
            "revenue": _number(pedidos["valor_pedido"].sum()),
            "fuel_cost": _number(pedidos["costo_combustible_base_L"].sum()),
            "distance_km": _number(pedidos["distancia_base_asignada_km"].sum(), 1),
            "delivered": delivered,
            "delayed": delayed,
            "on_time_rate": _number((delivered / total * 100) if total else 0, 1),
            "drivers": int(pedidos["nombre_repartidor"].nunique()),
            "vehicles": int(pedidos["id_vehiculo"].nunique()),
        }

    def municipalities(self, period: str = "all") -> list[dict[str, Any]]:
        pedidos = self._orders(period)
        grouped = (
            pedidos.groupby("ciudad", as_index=False)
            .agg(
                orders=("id_pedido", "count"),
                revenue=("valor_pedido", "sum"),
                fuel_cost=("costo_combustible_base_L", "sum"),
                distance_km=("distancia_base_asignada_km", "sum"),
            )
            .sort_values("orders", ascending=False)
        )
        return [
            {
                "name": row.ciudad,
                "orders": int(row.orders),
                "revenue": _number(row.revenue),
                "fuel_cost": _number(row.fuel_cost),
                "distance_km": _number(row.distance_km, 1),
            }
            for row in grouped.itertuples(index=False)
        ]

    def drivers(self, period: str = "all") -> list[dict[str, Any]]:
        pedidos = self._orders(period)
        grouped = (
            pedidos.groupby("nombre_repartidor", as_index=False)
            .agg(
                orders=("id_pedido", "count"),
                revenue=("valor_pedido", "sum"),
                fuel_cost=("costo_combustible_base_L", "sum"),
                distance_km=("distancia_base_asignada_km", "sum"),
                average_time=("tiempo_min", "mean"),
            )
            .sort_values("orders", ascending=False)
        )
        return [
            {
                "name": row.nombre_repartidor,
                "orders": int(row.orders),
                "revenue": _number(row.revenue),
                "fuel_cost": _number(row.fuel_cost),
                "distance_km": _number(row.distance_km, 1),
                "average_time": _number(row.average_time, 1),
            }
            for row in grouped.itertuples(index=False)
        ]

    def route_scenario(self, period: str = "all") -> dict[str, Any]:
        # Compara ocho rutas municipales con cuatro zonas compartidas; sin validación GPS.
        self._orders(period)  # Valida el periodo con la misma regla que el resto de la API.
        snapshot = self._load()
        routes = snapshot.sheets["Rutas_Diarias"].copy()
        dates = pd.to_datetime(routes["fecha_entrega"], errors="coerce")
        if period != "all":
            routes = routes.loc[dates.dt.to_period("M").astype(str) == period]
        pairs = (
            routes.groupby(["zona_propuesta", "municipios_atendidos", "nombre_repartidor_propuesto"], as_index=False)
            .agg(orders=("total_pedidos", "sum"), actual_km=("distancia_actual_km", "sum"),
                 proposed_km=("distancia_optimizada_km", "sum"), saving_km=("ahorro_km", "sum"),
                 actual_cost=("costo_actual", "sum"), proposed_cost=("costo_optimizado", "sum"),
                 saving_cost=("ahorro_costo", "sum"))
        )
        # La etiqueta de municipios se obtiene del plan maestro, no de las rutas activas de un mes.
        master_pairs = snapshot.sheets["Rutas_Comparacion"].set_index("zona_propuesta")["municipios"]
        paired = []
        for zone, group in pairs.groupby("zona_propuesta"):
            paired.append({
                "zone": zone,
                "municipalities": str(master_pairs.loc[zone]),
                "driver": group["nombre_repartidor_propuesto"].iloc[0],
                "orders": int(group["orders"].sum()),
                "actual_km": _number(group["actual_km"].sum()),
                "proposed_km": _number(group["proposed_km"].sum()),
                "saving_km": _number(group["saving_km"].sum()),
                "actual_cost": _number(group["actual_cost"].sum()),
                "proposed_cost": _number(group["proposed_cost"].sum()),
                "saving_cost": _number(group["saving_cost"].sum()),
            })
        monthly_salary = float(snapshot.sheets["Repartidores"]["salario_mensual_sup_L"].iloc[0])
        start_day = pd.to_datetime(routes["fecha_entrega"]).min().date()
        end_day = pd.to_datetime(routes["fecha_entrega"]).max().date()
        month_equivalents = sum(
            ((min(end_day, month.end_time.date()) - max(start_day, month.start_time.date())).days + 1)
            / month.days_in_month
            for month in pd.period_range(start_day, end_day, freq="M")
        )
        base_drivers = int(snapshot.sheets["Repartidores"]["id_repartidor"].nunique())
        proposed_drivers = int(snapshot.sheets["Rutas_Comparacion"]["repartidor_propuesto"].nunique())
        base_salary = _number(base_drivers * monthly_salary * month_equivalents)
        proposed_salary = _number(proposed_drivers * monthly_salary * month_equivalents)
        actual_cost = _number(routes["costo_actual"].sum())
        proposed_cost = _number(routes["costo_optimizado"].sum())
        return {
            "period": period,
            "date_min": pd.to_datetime(routes["fecha_entrega"]).min().date().isoformat(),
            "date_max": pd.to_datetime(routes["fecha_entrega"]).max().date().isoformat(),
            "routes": int(len(routes)),
            "orders": int(routes["total_pedidos"].sum()),
            "actual_km": _number(routes["distancia_actual_km"].sum()),
            "proposed_km": _number(routes["distancia_optimizada_km"].sum()),
            "saving_km": _number(routes["ahorro_km"].sum()),
            "actual_cost": actual_cost,
            "proposed_cost": proposed_cost,
            "saving_cost": _number(routes["ahorro_costo"].sum()),
            "routes_improved": int((routes["ahorro_km"] > 0).sum()),
            "base_routes": int(routes["cantidad_rutas_base"].sum()),
            "base_drivers": base_drivers,
            "proposed_drivers": proposed_drivers,
            "salary_monthly_per_driver_assumed": _number(monthly_salary),
            "salary_month_equivalents": _number(month_equivalents, 4),
            "base_salary_period_assumed": base_salary,
            "proposed_salary_period_assumed": proposed_salary,
            "salary_saving_period_assumed": _number(base_salary - proposed_salary),
            "total_cost_base_assumed": _number(actual_cost + base_salary),
            "total_cost_proposed_assumed": _number(proposed_cost + proposed_salary),
            "total_saving_assumed": _number(actual_cost + base_salary - proposed_cost - proposed_salary),
            "salary_saving_monthly_assumed": _number((base_drivers - proposed_drivers) * monthly_salary),
            "days_over_capacity": int((routes["cumple_capacidad"] != "Sí").sum()),
            "days_over_shift": int((routes["cumple_jornada_8h"] != "Sí").sum()),
            "pairs": paired,
        }

    def quality(self) -> dict[str, Any]:
        snapshot = self._load()
        pedidos = snapshot.sheets["Pedidos"]
        routes = snapshot.sheets["Rutas_Base"]
        daily = snapshot.sheets["Rutas_Diarias"]

        operational_names = ["Pedidos", "Rutas_Base", "Rutas_Diarias", "Rutas_Comparacion", "Clientes", "Vehiculos", "Repartidores"]
        nulls = int(sum(snapshot.sheets[name].isna().sum().sum() for name in operational_names))
        duplicate_orders = int(pedidos["id_pedido"].duplicated().sum())
        invalid_dates = int(pedidos["fecha_entrega"].isna().sum())

        km_delta = (
            routes["distancia_base_km"]
            - routes["distancia_reordenada_local_km"]
            - routes["ahorro_local_km"]
        ).abs()
        cost_delta = (
            routes["costo_base_L"]
            - routes["costo_reordenado_local_L"]
            - routes["ahorro_local_costo_L"]
        ).abs()
        time_delta = (
            routes["tiempo_base_min"]
            - routes["tiempo_reordenado_local_min"]
            - routes["ahorro_local_tiempo_min"]
        ).abs()

        clients = snapshot.sheets["Clientes"].set_index("id_cliente")
        vehicles = snapshot.sheets["Vehiculos"].set_index("id_vehiculo")
        drivers = snapshot.sheets["Repartidores"].set_index("id_repartidor")
        route_index = routes.set_index("id_ruta")
        bad_client = int((~pedidos["id_cliente"].isin(clients.index)).sum())
        bad_vehicle = int((~pedidos["id_vehiculo"].isin(vehicles.index)).sum())
        bad_driver = int((~pedidos["id_repartidor"].isin(drivers.index)).sum())
        bad_route = int((~pedidos["id_ruta"].isin(route_index.index)).sum())
        reference_issues = bad_client + bad_vehicle + bad_driver + bad_route

        expected_city = pedidos["id_cliente"].map(clients["zona"])
        expected_name = pedidos["id_cliente"].map(clients["nombre_cliente"])
        expected_driver_vehicle = pedidos["id_repartidor"].map(drivers["id_vehiculo"])
        master_mismatches = int((pedidos["ciudad"] != expected_city).sum() +
                                (pedidos["nombre_cliente"] != expected_name).sum() +
                                (pedidos["id_vehiculo"] != expected_driver_vehicle).sum())

        route_counts = pedidos.groupby("id_ruta")["id_pedido"].count()
        missing_routes = int((~routes["id_ruta"].isin(route_counts.index)).sum())
        wrong_route_counts = int((routes["total_pedidos"] != routes["id_ruta"].map(route_counts)).sum())
        route_link_issues = missing_routes + wrong_route_counts

        expected_cost = pedidos["distancia_base_asignada_km"] / pedidos["id_vehiculo"].map(vehicles["rendimiento_km_litro"]) * pedidos["id_vehiculo"].map(vehicles["costo_litro"])
        fuel_issues = int(((pedidos["costo_combustible_base_L"] - expected_cost).abs() > 0.02).sum())

        deadline = pd.to_timedelta(pedidos["hora_limite"] + ":00")
        arrival = pedidos["fecha_entrega"].dt.hour * 60 + pedidos["fecha_entrega"].dt.minute
        deadline_minutes = deadline.dt.total_seconds() / 60
        expected_status = np.where(arrival <= deadline_minutes, "Entregado", "Retrasado")
        status_issues = int((pedidos["estado_entrega"].to_numpy() != expected_status).sum())

        checks = [
            {"name": "Identificadores de pedidos", "status": "ok" if duplicate_orders == 0 else "warning", "detail": f"{duplicate_orders} duplicados"},
            {"name": "Fechas de entrega", "status": "ok" if invalid_dates == 0 else "warning", "detail": f"{invalid_dates} fechas inválidas"},
            {"name": "Consistencia de distancia", "status": "ok" if int((km_delta > 0.02).sum()) == 0 else "warning", "detail": f"{int((km_delta > 0.02).sum())} diferencias relevantes"},
            {"name": "Consistencia de costo", "status": "ok" if int((cost_delta > 0.02).sum()) == 0 else "warning", "detail": f"{int((cost_delta > 0.02).sum())} diferencias relevantes"},
            {"name": "Consistencia de tiempo", "status": "ok" if int((time_delta > 0.02).sum()) == 0 else "warning", "detail": f"{int((time_delta > 0.02).sum())} diferencias relevantes"},
            {"name": "Referencias entre hojas", "status": "ok" if reference_issues == 0 else "warning", "detail": f"{reference_issues} referencias ausentes"},
            {"name": "Datos maestros", "status": "ok" if master_mismatches == 0 else "warning", "detail": f"{master_mismatches} discrepancias"},
            {"name": "Pedidos por ruta", "status": "ok" if route_link_issues == 0 else "warning", "detail": f"{route_link_issues} diferencias"},
            {"name": "Costo por vehículo", "status": "ok" if fuel_issues == 0 else "warning", "detail": f"{fuel_issues} diferencias"},
            {"name": "Estado y plazo", "status": "ok" if status_issues == 0 else "warning", "detail": f"{status_issues} discrepancias"},
            {"name": "Campos operativos", "status": "ok" if nulls == 0 else "warning", "detail": f"{nulls} valores faltantes"},
        ]

        daily_km_delta = (daily["distancia_actual_km"] - daily["distancia_optimizada_km"] - daily["ahorro_km"]).abs()
        daily_cost_delta = (daily["costo_actual"] - daily["costo_optimizado"] - daily["ahorro_costo"]).abs()
        route_coverage = int(daily["total_pedidos"].sum() != len(pedidos) or daily["cantidad_rutas_base"].sum() != len(routes))
        checks.extend([
            {"name": "Cobertura de la propuesta", "status": "ok" if route_coverage == 0 else "warning", "detail": f"{route_coverage} diferencias de cobertura"},
            {"name": "Comparación de kilómetros", "status": "ok" if int((daily_km_delta > 0.02).sum()) == 0 else "warning", "detail": f"{int((daily_km_delta > 0.02).sum())} diferencias"},
            {"name": "Comparación de combustible", "status": "ok" if int((daily_cost_delta > 0.02).sum()) == 0 else "warning", "detail": f"{int((daily_cost_delta > 0.02).sum())} diferencias"},
        ])

        warnings = sum(check["status"] == "warning" for check in checks)
        score = max(0, round((1 - warnings / len(checks)) * 100))
        return {
            "score": score,
            "rows_analyzed": int(sum(len(snapshot.sheets[name]) for name in operational_names)),
            "missing_values": nulls,
            "duplicate_orders": duplicate_orders,
            "invalid_dates": invalid_dates,
            "checks": checks,
            "route_differences": {
                "distance": int((km_delta > 0.02).sum()),
                "cost": int((cost_delta > 0.02).sum()),
                "time": int((time_delta > 0.02).sum()),
                "max_cost_difference": _number(cost_delta.max()),
            },
        }


data_service = LogisticsDataService()
