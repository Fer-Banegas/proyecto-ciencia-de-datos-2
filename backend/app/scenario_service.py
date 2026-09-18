"""Simulador local: conserva la fuente y calcula propuestas sin modificarla."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from io import BytesIO
from itertools import permutations
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from secrets import token_urlsafe
from zipfile import BadZipFile, ZipFile

import pandas as pd

from .config import DEFAULT_DATASET
from .errors import DatasetError


REFERENCE = DEFAULT_DATASET
MAX_BYTES = 15 * 1024 * 1024
REQUIRED = {
    "Pedidos": {"id_pedido", "fecha_entrega", "id_cliente", "prioridad"},
    "Clientes": {"id_cliente", "zona", "latitud", "longitud"},
    "Vehiculos": {"id_vehiculo"},
    "Repartidores": {"id_repartidor", "nombre_repartidor", "id_vehiculo", "zona_base"},
}
WEST = {"Arizona", "Tela", "Esparta", "La Masica", "San Francisco", "El Porvenir"}
EAST = {"Jutiapa"}


def _round(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    h = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return _round(6371 * 2 * asin(sqrt(min(1, h))) * 1.25)


def _path_km(points: list[tuple[float, float]], center: tuple[float, float]) -> float:
    path = [center, *points, center]
    return _round(sum(_distance(a, b) for a, b in zip(path, path[1:])))


def _local_km(points: list[tuple[float, float]], center: tuple[float, float]) -> tuple[float, float]:
    original = _path_km(points, center)
    if len(points) < 2:
        return original, original
    if len(points) <= 8:
        best = min(_path_km(list(path), center) for path in permutations(points))
    else:
        # Solo una aproximación para grupos grandes; nunca se presenta como óptimo global.
        left, position, path = points.copy(), center, []
        while left:
            nearest = min(left, key=lambda x: _distance(position, x))
            path.append(nearest)
            left.remove(nearest)
            position = nearest
        best = _path_km(path, center)
    return original, min(original, best)


def _read(book: BytesIO | Path) -> dict[str, pd.DataFrame]:
    try:
        excel = pd.ExcelFile(book)
        absent = REQUIRED.keys() - set(excel.sheet_names)
        if absent:
            raise DatasetError(f"Faltan hojas: {', '.join(sorted(absent))}.", "MISSING_SHEETS")
        sheets = {name: pd.read_excel(excel, sheet_name=name) for name in excel.sheet_names if name in REQUIRED or name in {"Rutas_Base", "Parametros_Operacion"}}
    except DatasetError:
        raise
    except Exception as exc:
        raise DatasetError("No pudimos abrir el Excel. Comprueba que sea un .xlsx válido.", "INVALID_DATASET") from exc
    for name, columns in REQUIRED.items():
        missing = columns - set(sheets[name].columns)
        if missing:
            raise DatasetError(f"{name}: faltan columnas {', '.join(sorted(missing))}.", "MISSING_COLUMNS")
        if sheets[name].empty:
            raise DatasetError(f"{name} está vacía.", "EMPTY_SHEET")
    return sheets


@dataclass
class Source:
    name: str
    kind: str
    orders: int
    cities: list[str]
    roads: dict[str, float]
    vehicles: list[dict]
    drivers: list[dict]
    fuel_price: float
    routes: list[dict]
    notes: list[str]
    monthly_salary_assumed: float
    start_date: str
    end_date: str

    def public(self, identifier: str) -> dict:
        return {
            "source_id": identifier, "filename": self.name, "format": self.kind,
            "orders": self.orders, "municipalities": self.cities,
            "drivers": self.drivers, "vehicles": self.vehicles,
            "fuel_price": self.fuel_price, "notes": self.notes,
            "monthly_salary_assumed": self.monthly_salary_assumed,
            "start_date": self.start_date, "end_date": self.end_date,
            "zones": default_zones(self),
        }


def _build_source(book: BytesIO | Path, name: str) -> Source:
    sheets = _read(book)
    orders, clients, vehicles, drivers = (sheets[key].copy() for key in ("Pedidos", "Clientes", "Vehiculos", "Repartidores"))
    corrected = "Rutas_Base" in sheets and "distancia_base_km" in sheets["Rutas_Base"].columns
    if orders.id_pedido.isna().any() or orders.id_pedido.duplicated().any():
        raise DatasetError("Pedidos: hay identificadores vacíos o repetidos.", "INVALID_ORDERS")
    for label, frame, key in (("Clientes", clients, "id_cliente"), ("Vehiculos", vehicles, "id_vehiculo"), ("Repartidores", drivers, "id_repartidor")):
        if frame[key].isna().any() or frame[key].duplicated().any():
            raise DatasetError(f"{label}: identificadores vacíos o repetidos.", "INVALID_MASTER")
    dates = pd.to_datetime(orders.fecha_entrega, errors="coerce")
    if dates.isna().any() or orders.id_cliente.isna().any() or (~orders.id_cliente.isin(clients.id_cliente)).any():
        raise DatasetError("Pedidos: fecha inválida o cliente desconocido.", "INVALID_ORDERS")
    orders["day"] = dates.dt.strftime("%Y-%m-%d")
    clients = clients.set_index("id_cliente")
    orders["municipality"] = orders.id_cliente.map(clients.zona)
    if orders.municipality.isna().any():
        raise DatasetError("Hay pedidos sin municipio válido.", "INVALID_CITY")
    cities = sorted(set(orders.municipality))
    notes = ["Las distancias locales son estimadas con coordenadas y factor vial 1.25; no son trazas GPS."]
    reference = _read(REFERENCE)
    reference_vehicles = reference["Vehiculos"].set_index("id_vehiculo")
    params = reference["Parametros_Operacion"]
    roads = {str(row.iloc[0]): float(row.iloc[1]) for _, row in params.head(8).iterrows()}
    if corrected and "Parametros_Operacion" in sheets:
        roads = {str(row.iloc[0]): float(row.iloc[1]) for _, row in sheets["Parametros_Operacion"].head(8).iterrows()}
    if any(city not in roads for city in cities):
        raise DatasetError("El archivo contiene municipios sin distancia de referencia.", "UNKNOWN_CITY")
    pool = []
    for row in vehicles.to_dict("records"):
        vid = str(row["id_vehiculo"])
        if vid not in reference_vehicles.index and not {"rendimiento_km_litro", "capacidad_pedidos", "velocidad_promedio_kmh"}.issubset(vehicles.columns):
            raise DatasetError(f"Faltan parámetros del vehículo {vid}.", "UNKNOWN_VEHICLE")
        ref = reference_vehicles.loc[vid] if vid in reference_vehicles.index else row
        entry = {"id": vid, "name": str(row.get("tipo_vehiculo", vid)),
                 "efficiency": float(row.get("rendimiento_km_litro", ref["rendimiento_km_litro"])),
                 "capacity": int(row.get("capacidad_pedidos", ref["capacidad_pedidos"])),
                 "speed": float(row.get("velocidad_promedio_kmh", ref["velocidad_promedio_kmh"]))}
        if not all(entry[key] > 0 for key in ("efficiency", "capacity", "speed")):
            raise DatasetError(f"Parámetros inválidos para {vid}.", "INVALID_VEHICLE")
        pool.append(entry)
    fuel_price = float(reference["Vehiculos"].costo_litro.iloc[0])
    if corrected:
        fuel_price = float(vehicles.costo_litro.iloc[0])
    staff = [{"id": str(row.id_repartidor), "name": str(row.nombre_repartidor), "vehicle_id": str(row.id_vehiculo), "base_city": str(row.zona_base)} for row in drivers.itertuples()]
    if len({item["base_city"] for item in staff}) != len(staff):
        raise DatasetError("Cada municipio base debe tener un repartidor único.", "INVALID_DRIVERS")
    if corrected:
        base = sheets["Rutas_Base"]
        required_base = {"fecha_entrega", "municipio", "total_pedidos", "distancia_base_km", "costo_base_L", "km_reparto_local_reordenado"}
        if not required_base.issubset(base.columns) or base.empty:
            raise DatasetError("Rutas_Base incompleta.", "INVALID_ROUTES")
        records = [{"day": str(row.fecha_entrega)[:10], "city": str(row.municipio), "orders": int(row.total_pedidos),
                    "base_km": float(row.distancia_base_km), "base_cost": float(row.costo_base_L),
                    "local_after": float(row.km_reparto_local_reordenado)} for row in base.itertuples()]
        if sum(r["orders"] for r in records) != len(orders) or set(r["city"] for r in records) != set(cities):
            raise DatasetError("Las rutas base no cubren todos los pedidos.", "INVALID_ROUTES")
        counts = orders.groupby(["day", "municipality"]).size().to_dict()
        route_counts: dict[tuple[str, str], int] = {}
        for route in records:
            key = (route["day"], route["city"])
            route_counts[key] = route_counts.get(key, 0) + route["orders"]
        if route_counts != counts:
            raise DatasetError("Rutas_Base no coincide con los pedidos por fecha y municipio.", "INVALID_ROUTES")
    else:
        notes.append("El Excel original no tiene rutas coherentes para esta simulación: la base se reconstruye a partir de pedidos, clientes y distancias de referencia del proyecto.")
        notes.append("Vehículos sin parámetros operativos usan la tabla validada del caso Atlántida.")
        vehicle_map = {item["id"]: item for item in pool}
        city_driver = {item["base_city"]: item for item in staff}
        records = []
        for (day, city), group in orders.sort_values(["fecha_entrega", "id_pedido"]).groupby(["day", "municipality"], sort=True):
            if city not in city_driver or city_driver[city]["vehicle_id"] not in vehicle_map:
                raise DatasetError(f"Falta repartidor o vehículo base para {city}.", "INVALID_DRIVERS")
            city_clients = clients.loc[clients.zona == city]
            center = (float(city_clients.latitud.mean()), float(city_clients.longitud.mean()))
            points = [(float(clients.loc[cid].latitud), float(clients.loc[cid].longitud)) for cid in group.id_cliente]
            if any(not all(pd.notna(x) for x in point) for point in points):
                raise DatasetError("Hay coordenadas de clientes incompletas.", "INVALID_COORDINATES")
            local_before, local_after = _local_km(points, center)
            vehicle = vehicle_map[city_driver[city]["vehicle_id"]]
            km = _round(2 * roads[city] + local_before)
            records.append({"day": day, "city": city, "orders": len(group), "base_km": km,
                            "base_cost": _round(km / vehicle["efficiency"] * fuel_price), "local_after": local_after})
    if any(r["base_km"] < 0 or r["base_cost"] < 0 or r["local_after"] < 0 for r in records):
        raise DatasetError("Las rutas contienen distancias o costos negativos.", "INVALID_ROUTES")
    salary_column = pd.to_numeric(drivers.get("salario_mensual_sup_L", pd.Series(dtype=float)), errors="coerce").dropna()
    monthly_salary = float(salary_column.iloc[0]) if not salary_column.empty and salary_column.iloc[0] > 0 else 18000.0
    if salary_column.empty:
        notes.append("El Excel no incluye salario: se usa el supuesto académico de L 18,000 mensuales por repartidor.")
    elif salary_column.nunique() > 1:
        notes.append("Los salarios del Excel varían: la comparación usa el primer salario como supuesto uniforme; no es una nómina real.")
    return Source(name, "Preparado" if corrected else "Original normalizado", len(orders), cities, roads, pool, staff, fuel_price, records, notes,
                  monthly_salary, min(r["day"] for r in records), max(r["day"] for r in records))


def default_zones(source: Source) -> list[dict]:
    planned = [("La Ceiba", "Jutiapa"), ("El Porvenir", "San Francisco"), ("La Masica", "Esparta"), ("Arizona", "Tela")]
    by_city = {person["base_city"]: person for person in source.drivers}
    default_driver_ids = ("R001", "R004", "R007", "R002")
    by_id = {person["id"]: person for person in source.drivers}
    zones = []
    for pair, lead_id in zip(planned, default_driver_ids):
        cities = [city for city in pair if city in source.cities]
        if cities and (lead_id in by_id or cities[0] in by_city):
            driver = by_id.get(lead_id) or by_city[cities[0]]
            zones.append({"id": f"Z{len(zones)+1}", "municipalities": cities, "driver_id": driver["id"], "vehicle_id": driver["vehicle_id"]})
    for city in source.cities:
        if city not in {x for zone in zones for x in zone["municipalities"]}:
            driver = by_city.get(city)
            if driver:
                zones.append({"id": f"Z{len(zones)+1}", "municipalities": [city], "driver_id": driver["id"], "vehicle_id": driver["vehicle_id"]})
    return zones


def _trunk(cities: list[str], roads: dict[str, float]) -> float:
    # Los dos corredores opuestos se cuentan por separado; no se simula un enlace transversal ficticio.
    west = max((roads[c] for c in cities if c in WEST), default=0)
    east = max((roads[c] for c in cities if c in EAST), default=0)
    return 2 * (west + east)


def _salary_months(start: str, end: str) -> float:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    month = pd.Period(first, freq="M")
    final_month = pd.Period(last, freq="M")
    equivalents = 0.0
    while month <= final_month:
        start_day = max(first, month.start_time.date())
        end_day = min(last, month.end_time.date())
        equivalents += ((end_day - start_day).days + 1) / month.days_in_month
        month += 1
    return equivalents


def simulate(source: Source, request: dict, include_reference: bool = True) -> dict:
    zones = request.get("zones")
    staff = request.get("drivers")
    if not isinstance(zones, list) or not 1 <= len(zones) <= 16 or not isinstance(staff, list) or not 1 <= len(staff) <= 32:
        raise DatasetError("Define entre 1 y 16 zonas y un equipo de repartidores.", "INVALID_SCENARIO")
    try:
        fuel = float(request.get("fuel_price", source.fuel_price))
    except (TypeError, ValueError) as exc:
        raise DatasetError("El precio del combustible debe ser numérico.", "INVALID_FUEL") from exc
    if not 0 < fuel <= 1000:
        raise DatasetError("El precio del combustible debe ser positivo y razonable.", "INVALID_FUEL")
    people = {}
    for person in staff:
        identifier = str(person.get("id", "")).strip()
        name = str(person.get("name", "")).strip()
        if not identifier or not name or len(name) > 90 or identifier in people:
            raise DatasetError("Los repartidores necesitan identificador y nombre únicos.", "INVALID_DRIVERS")
        people[identifier] = name
    fleet = {vehicle["id"]: vehicle for vehicle in source.vehicles}
    vehicle_states = request.get("vehicle_states", {})
    if not isinstance(vehicle_states, dict) or any(vehicle_id not in fleet or state not in {"available", "reserve", "inactive"} for vehicle_id, state in vehicle_states.items()):
        raise DatasetError("Los estados de vehículos no son válidos.", "INVALID_VEHICLE_STATE")
    assigned_cities, used_drivers, used_vehicles, normalized = set(), set(), set(), []
    for zone in zones:
        cities = zone.get("municipalities")
        driver_id, vehicle_id = str(zone.get("driver_id", "")), str(zone.get("vehicle_id", ""))
        if not isinstance(cities, list) or not cities or len(set(cities)) != len(cities):
            raise DatasetError("Cada zona necesita municipios sin repetir.", "INVALID_ZONE")
        if any(city not in source.cities or city in assigned_cities for city in cities):
            raise DatasetError("Hay municipios desconocidos o asignados a más de una zona.", "DUPLICATE_CITY")
        if driver_id not in people or driver_id in used_drivers or vehicle_id not in fleet or vehicle_id in used_vehicles:
            raise DatasetError("Cada zona necesita un repartidor y vehículo disponibles y distintos.", "DUPLICATE_RESOURCE")
        if vehicle_states.get(vehicle_id, "available") != "available":
            raise DatasetError(f"El vehículo {vehicle_id} está de reserva o fuera del escenario; actívalo antes de asignarlo.", "UNAVAILABLE_VEHICLE")
        assigned_cities.update(cities)
        used_drivers.add(driver_id)
        used_vehicles.add(vehicle_id)
        normalized.append({"id": str(zone.get("id") or f"Z{len(normalized)+1}")[:24], "municipalities": cities,
                           "driver_id": driver_id, "driver": people[driver_id], "vehicle_id": vehicle_id})
    if assigned_cities != set(source.cities):
        raise DatasetError(f"Faltan municipios: {', '.join(sorted(set(source.cities)-assigned_cities))}.", "UNCOVERED_CITY")
    details, issues = [], []
    for zone in normalized:
        fleet_item = fleet[zone["vehicle_id"]]
        rows = [r for r in source.routes if r["city"] in zone["municipalities"]]
        by_day: dict[str, list[dict]] = {}
        for row in rows:
            by_day.setdefault(row["day"], []).append(row)
        current_km = _round(sum(r["base_km"] for r in rows))
        current_cost = _round(sum(r["base_cost"] for r in rows))
        proposed_km, proposed_cost = 0.0, 0.0
        for day, active in by_day.items():
            km = _round(_trunk([r["city"] for r in active], source.roads) + sum(r["local_after"] for r in active))
            count = sum(r["orders"] for r in active)
            if count > fleet_item["capacity"]:
                issues.append(f"{day}: {zone['id']} tiene {count} pedidos; capacidad {fleet_item['capacity']}.")
            minutes = km / fleet_item["speed"] * 60 + count * 8
            if minutes > 480:
                issues.append(f"{day}: {zone['id']} requiere {round(minutes)} min; supera 480 min.")
            proposed_km += km
            proposed_cost += _round(km / fleet_item["efficiency"] * fuel)
        details.append({**zone, "orders": sum(r["orders"] for r in rows), "base_routes": len(rows), "proposed_routes": len(by_day),
                        "before_km": current_km, "after_km": _round(proposed_km), "delta_km": _round(current_km-proposed_km),
                        "before_cost": current_cost, "after_cost": _round(proposed_cost), "delta_cost": _round(current_cost-proposed_cost)})
    before_km = _round(sum(r["base_km"] for r in source.routes))
    before_cost = _round(sum(r["base_cost"] for r in source.routes))
    after_km = _round(sum(r["after_km"] for r in details))
    after_cost = _round(sum(r["after_cost"] for r in details))
    def metric(before: float, after: float) -> dict:
        difference = _round(before - after)
        return {"before": before, "after": after, "saving": difference, "percent": _round(difference / before * 100) if before else 0}
    salary_months = _salary_months(source.start_date, source.end_date)
    before_salary = _round(len(source.drivers) * source.monthly_salary_assumed * salary_months)
    after_salary = _round(len(used_drivers) * source.monthly_salary_assumed * salary_months)
    fleet_status = {"in_route": sorted(used_vehicles), "reserve": sorted(vehicle_id for vehicle_id, state in vehicle_states.items() if state == "reserve" and vehicle_id not in used_vehicles),
                    "inactive": sorted(vehicle_id for vehicle_id, state in vehicle_states.items() if state == "inactive" and vehicle_id not in used_vehicles)}
    result = {"filename": source.name, "format": source.kind, "orders": source.orders, "fuel_price_source": source.fuel_price,
            "fuel_price_scenario": fuel, "kilometers": metric(before_km, after_km), "fuel_cost": metric(before_cost, after_cost),
            "routes": metric(len(source.routes), sum(x["proposed_routes"] for x in details)),
            "drivers": metric(len(source.drivers), len(used_drivers)),
            "vehicles": metric(len({person['vehicle_id'] for person in source.drivers}), len(used_vehicles)),
            "salary": metric(before_salary, after_salary),
            "total_cost": metric(_round(before_cost + before_salary), _round(after_cost + after_salary)),
            "salary_monthly_assumed": source.monthly_salary_assumed,
            "start_date": source.start_date, "end_date": source.end_date,
            "fleet_status": fleet_status,
            "zones": details, "warnings": issues[:30],
            "notes": source.notes + ["Precio del escenario distinto al de origen: el cambio de costo combina rutas y precio."] if abs(fuel-source.fuel_price)>0.0001 else source.notes,
            "method": "Ruta diaria = traslados de corredor desde La Ceiba + reparto local estimado; costo = km / rendimiento del vehículo × precio por litro."}
    if include_reference:
        try:
            reference = simulate(source, {"zones": default_zones(source), "drivers": source.drivers, "fuel_price": source.fuel_price}, False)
            result["reference"] = {key: reference[key] for key in ("kilometers", "fuel_cost", "routes", "drivers", "vehicles", "salary", "total_cost")}
        except DatasetError:
            result["reference"] = None
            result["notes"] = result["notes"] + ["No se pudo construir la propuesta automática para este archivo; la simulación sí se comparó con la base."]
    return result


_sessions: dict[str, Source] = {}


def get_source(identifier: str) -> Source:
    if identifier == "default":
        return _build_source(DEFAULT_DATASET, DEFAULT_DATASET.name)
    if identifier not in _sessions:
        raise DatasetError("La sesión del archivo expiró. Vuelve a cargar el Excel.", "UNKNOWN_SOURCE")
    return _sessions[identifier]


def import_source(content: bytes, name: str) -> dict:
    if not name.lower().endswith(".xlsx") or not content or len(content) > MAX_BYTES:
        raise DatasetError("Carga un .xlsx no vacío de hasta 15 MB.", "INVALID_UPLOAD")
    try:
        with ZipFile(BytesIO(content)) as archive:
            if len(archive.infolist()) > 500 or sum(x.file_size for x in archive.infolist()) > 80 * 1024 * 1024:
                raise DatasetError("El archivo es demasiado grande al descomprimirse.", "INVALID_UPLOAD")
            if "xl/workbook.xml" not in archive.namelist():
                raise DatasetError("El archivo no es un Excel .xlsx válido.", "INVALID_UPLOAD")
    except BadZipFile as exc:
        raise DatasetError("El archivo no es un Excel .xlsx válido.", "INVALID_UPLOAD") from exc
    source = _build_source(BytesIO(content), name[:120])
    identifier = token_urlsafe(18)
    if len(_sessions) >= 8:
        _sessions.pop(next(iter(_sessions)))
    _sessions[identifier] = source
    return source.public(identifier)
