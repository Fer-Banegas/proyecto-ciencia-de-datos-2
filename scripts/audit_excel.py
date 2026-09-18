from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import pandas as pd


def main(path: Path) -> None:
    sheets = pd.read_excel(path, sheet_name=None)
    for name, frame in sheets.items():
        print(f"\n{name}: {len(frame)} filas, {len(frame.columns)} columnas")
        print("nulos:", {k: int(v) for k, v in frame.isna().sum().items() if v})
    p, c, v, d, r = (sheets[k] for k in ("Pedidos", "Clientes", "Vehiculos", "Repartidores", "Rutas_Base"))
    daily, compared = sheets["Rutas_Diarias"], sheets["Rutas_Comparacion"]
    print("\nPERIODOS", pd.to_datetime(p.fecha_entrega).dt.to_period("M").value_counts().to_dict())
    print("PEDIDOS", "ids duplicados", p.id_pedido.duplicated().sum(), "estado", p.estado_entrega.value_counts().to_dict(), "prioridad", p.prioridad.value_counts().to_dict())
    for tab, key in ((c, "id_cliente"), (v, "id_vehiculo"), (d, "id_repartidor"), (r, "id_ruta")):
        print("MASTER", key, "duplicados", tab[key].duplicated().sum())
    print("REFERENCIAS", {key: sorted(set(p[key]) - set(tab[key])) for key, tab in (("id_cliente", c), ("id_vehiculo", v), ("id_repartidor", d))})
    for key, parent, fields in (("id_cliente", c, [("nombre_cliente", "nombre_cliente"), ("ciudad", "zona"), ("latitud", "latitud"), ("longitud", "longitud")]), ("id_vehiculo", v, [("tipo_vehiculo", "tipo_vehiculo")]), ("id_repartidor", d, [("nombre_repartidor", "nombre_repartidor"), ("id_vehiculo", "id_vehiculo")])):
        m = p.merge(parent, on=key, suffixes=("_p", "_m"), validate="many_to_one")
        for a, b in fields:
            x, y = m[f"{a}_p"] if a in parent and a != key else m[a], m[f"{b}_m"] if b in p and b != key else m[b]
            print("MATCH", key, a, b, int((x.astype(str) != y.astype(str)).sum()))
    print("PEDIDOS RANGOS", p[["tiempo_min", "distancia_base_asignada_km", "costo_combustible_base_L", "valor_pedido"]].agg(["min", "median", "max", "sum"]).to_dict())
    print("FECHAS RUTAS", pd.to_datetime(r.fecha_entrega).dt.to_period("M").value_counts().to_dict())
    print("RUTAS IDS", r.id_ruta.nunique(), "pedidos total", r.total_pedidos.sum(), "pedido IDs en orden", sum(len(str(x).split(" > ")) for x in r.orden_local_reordenado))
    routes_ids = [z for x in r.orden_local_reordenado for z in str(x).split(" > ")]
    print("RUTA/PEDIDO COBERTURA", "ids desconocidos", len(set(routes_ids) - set(p.id_pedido)), "no cubiertos", len(set(p.id_pedido) - set(routes_ids)), "repetidos", sum(n > 1 for n in Counter(routes_ids).values()))
    for a, b, s in (("distancia_base_km", "distancia_reordenada_local_km", "ahorro_local_km"), ("costo_base_L", "costo_reordenado_local_L", "ahorro_local_costo_L"), ("tiempo_base_min", "tiempo_reordenado_local_min", "ahorro_local_tiempo_min")):
        delta = (r[a] - r[b] - r[s]).abs()
        print("RECONCILIACION", a, "mayor 0.02", int((delta > 0.02).sum()), "max", round(delta.max(), 2), "sum", round(delta.sum(), 2))
    print("VEHICULOS", v.to_dict(orient="records"))
    print("REPARTIDORES", d.to_dict(orient="records"))
    print("RUTAS SAMPLE", r.head(3).to_dict(orient="records"))
    if "hora_limite" in p.columns:
        assert p.id_pedido.is_unique and r.id_ruta.is_unique
        assert not (set(p.id_cliente) - set(c.id_cliente))
        assert not (set(p.id_vehiculo) - set(v.id_vehiculo))
        assert not (set(p.id_repartidor) - set(d.id_repartidor))
        assert not (set(p.id_ruta) ^ set(r.id_ruta))
        assert set(routes_ids) == set(p.id_pedido)
        assert len(routes_ids) == len(set(routes_ids)) == len(p)
        assert (p.id_cliente.map(c.set_index("id_cliente").zona) == p.ciudad).all()
        assert (p.id_cliente.map(c.set_index("id_cliente").nombre_cliente) == p.nombre_cliente).all()
        assert (p.id_repartidor.map(d.set_index("id_repartidor").id_vehiculo) == p.id_vehiculo).all()
        assert (p.groupby("id_ruta").size().reindex(r.id_ruta).to_numpy() == r.total_pedidos.to_numpy()).all()
        assert abs(p.distancia_base_asignada_km.sum() - r.distancia_base_km.sum()) < 0.02
        assert abs(p.costo_combustible_base_L.sum() - r.costo_base_L.sum()) < 0.02
        for actual, proposed, saving in (("distancia_base_km", "distancia_reordenada_local_km", "ahorro_local_km"), ("costo_base_L", "costo_reordenado_local_L", "ahorro_local_costo_L"), ("tiempo_base_min", "tiempo_reordenado_local_min", "ahorro_local_tiempo_min")):
            assert ((r[actual] - r[proposed] - r[saving]).abs() < 0.02).all()
            assert (r[saving] >= 0).all()
        price = p.id_vehiculo.map(v.set_index("id_vehiculo").costo_litro)
        efficiency = p.id_vehiculo.map(v.set_index("id_vehiculo").rendimiento_km_litro)
        assert ((p.costo_combustible_base_L - p.distancia_base_asignada_km / efficiency * price).abs() < 0.02).all()
        arrival = p.fecha_entrega.dt.hour * 60 + p.fecha_entrega.dt.minute
        limit = pd.to_timedelta(p.hora_limite + ":00").dt.total_seconds() / 60
        assert ((p.estado_entrega == "Entregado") == (arrival <= limit)).all()
        assert daily.total_pedidos.sum() == len(p)
        assert daily.cantidad_rutas_base.sum() == len(r)
        assert abs(daily.distancia_actual_km.sum() - r.distancia_base_km.sum()) < 0.02
        assert abs(daily.costo_actual.sum() - r.costo_base_L.sum()) < 0.02
        assert ((daily.distancia_actual_km - daily.distancia_optimizada_km - daily.ahorro_km).abs() < 0.02).all()
        assert ((daily.costo_actual - daily.costo_optimizado - daily.ahorro_costo).abs() < 0.02).all()
        for col, daily_col in (("distancia_actual_km", "distancia_actual_km"), ("distancia_optimizada_km", "distancia_optimizada_km"), ("ahorro_km", "ahorro_km"), ("costo_actual", "costo_actual"), ("costo_optimizado", "costo_optimizado"), ("ahorro_costo", "ahorro_costo")):
            assert abs(compared[col].sum() - daily[daily_col].sum()) < 0.02
        assert (compared.ahorro_km > 0).all()
        assert set(compared.zona_propuesta) == {"Z1", "Z2", "Z3", "Z4"}
        assert all(not sheets[name].isna().any().any() for name in ("Pedidos", "Rutas_Base", "Rutas_Diarias", "Rutas_Comparacion", "Clientes", "Vehiculos", "Repartidores"))
        print("AUDITORÍA: APROBADA")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
