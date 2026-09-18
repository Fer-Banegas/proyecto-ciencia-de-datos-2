import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const sourcePath = path.join(dataDir, "Distribuidora_Atlantida_Express.xlsx");
const outputPath = path.join(dataDir, "Distribuidor Atlántida Express 2.xlsx");
const original = await SpreadsheetFile.importXlsx(await FileBlob.load(sourcePath));
const records = (name) => {
  const [headers, ...data] = original.worksheets.getItem(name).getUsedRange().values;
  return data.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
};
const round = (x, d = 2) => Math.round((x + Number.EPSILON) * 10 ** d) / 10 ** d;
const serialDay = (n) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const clock = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
const depot = { latitud: 15.7698, longitud: -86.7919 };
// Kilómetros de carretera hasta el casco urbano; la operación sigue siendo ficticia.
const roadKm = { Arizona: 72.5, "El Porvenir": 16.5, Esparta: 75.5, Jutiapa: 31.4, "La Ceiba": 0, "La Masica": 41.2, "San Francisco": 35, Tela: 102.3 };
const distanceSource = {
  Arizona: "https://www.rome2rio.com/es/s/Arizona-Honduras/La-Ceiba",
  "El Porvenir": "https://www.rome2rio.com/es/s/La-Ceiba/El-Porvenir",
  Esparta: "https://www.rome2rio.com/es/s/La-Ceiba/Esparta-Atl%C3%A1ntida-Honduras",
  Jutiapa: "https://www.rome2rio.com/es/s/La-Ceiba/Jutiapa-Atl%C3%A1ntida-Honduras",
  "La Ceiba": "Sede principal: distancia intermunicipal nula",
  "La Masica": "https://www.rome2rio.com/es/s/La-Ceiba/La-Masica",
  "San Francisco": "Estimación de planificación; validar en carretera (30–40 km)",
  Tela: "https://www.rome2rio.com/es/s/Tela/La-Ceiba",
};
const fuelPerGallon = 144.32;
const gallonsToLiters = 3.785411784;
const fuelPerLiter = round(fuelPerGallon / gallonsToLiters, 4);
const monthlySalaryAssumption = 18000;
const proposedZones = [
  { id: "Z1", cities: ["La Ceiba", "Jutiapa"], driver: "R001" },
  { id: "Z2", cities: ["El Porvenir", "San Francisco"], driver: "R004" },
  { id: "Z3", cities: ["La Masica", "Esparta"], driver: "R007" },
  { id: "Z4", cities: ["Arizona", "Tela"], driver: "R002" },
];
function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitud - a.latitud) * rad;
  const dLon = (b.longitud - a.longitud) * rad;
  const z = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitud * rad) * Math.cos(b.latitud * rad) * Math.sin(dLon / 2) ** 2;
  return round(6371 * 2 * Math.atan2(Math.sqrt(z), Math.sqrt(1 - z)) * 1.25);
}
function routeLength(path, center) {
  let previous = center;
  let total = 0;
  for (const stop of path) { total += distance(previous, stop.client); previous = stop.client; }
  return round(total + distance(previous, center));
}
function shortest(stops, center) {
  if (stops.length < 2) return [...stops];
  let best, bestKm = Infinity;
  const walk = (left, chosen) => {
    if (!left.length) {
      const km = routeLength(chosen, center);
      if (km < bestKm - 0.001) { best = chosen; bestKm = km; }
      return;
    }
    left.forEach((item, i) => walk([...left.slice(0, i), ...left.slice(i + 1)], [...chosen, item]));
  };
  walk(stops, []);
  return best;
}

const clients = records("Clientes");
const vehicles = records("Vehiculos");
const drivers = records("Repartidores");
const sourceOrders = records("Pedidos");
const clientById = new Map(clients.map((x) => [x.id_cliente, x]));
const driverByZone = new Map(drivers.map((x) => [x.zona_base, x]));
const vehicleById = new Map(vehicles.map((x) => [x.id_vehiculo, x]));
const cityCenter = new Map([...new Set(clients.map((x) => x.zona))].map((city) => {
  const group = clients.filter((x) => x.zona === city);
  return [city, { latitud: group.reduce((n, x) => n + x.latitud, 0) / group.length, longitud: group.reduce((n, x) => n + x.longitud, 0) / group.length }];
}));
const settings = { V001: [11, 50, 12], V002: [10.5, 48, 12], V003: [10, 47, 12], V004: [10.5, 49, 12], V005: [8, 43, 20], V006: [10, 47, 12], V007: [10, 46, 12], V008: [7.5, 42, 20] };
for (const v of vehicles) {
  [v.rendimiento_km_litro, v.velocidad_promedio_kmh, v.capacidad_pedidos] = settings[v.id_vehiculo];
  v.costo_litro = fuelPerLiter;
}
const groups = new Map();
for (const source of sourceOrders) {
  const client = clientById.get(source.id_cliente);
  const driver = driverByZone.get(client.zona);
  const day = serialDay(source.fecha_entrega);
  const key = `${iso(day)}|${driver.id_repartidor}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ source, client, driver, day });
}
const orderHeader = ["id_pedido", "fecha_entrega", "id_cliente", "nombre_cliente", "ciudad", "latitud", "longitud", "id_repartidor", "nombre_repartidor", "id_vehiculo", "tipo_vehiculo", "id_ruta", "hora_salida", "hora_llegada", "tiempo_min", "distancia_base_asignada_km", "costo_combustible_base_L", "estado_entrega", "prioridad", "orden_actual", "orden_local_reordenado", "valor_pedido", "hora_limite", "km_reparto_local_base", "km_troncal_base_asignado"];
const routeHeader = ["id_ruta", "fecha_entrega", "id_repartidor", "nombre_repartidor", "id_vehiculo", "tipo_vehiculo", "total_pedidos", "distancia_base_km", "distancia_reordenada_local_km", "ahorro_local_km", "ahorro_local_porcentaje", "costo_base_L", "costo_reordenado_local_L", "ahorro_local_costo_L", "tiempo_base_min", "tiempo_reordenado_local_min", "ahorro_local_tiempo_min", "orden_local_reordenado", "municipio", "km_troncal_ida", "km_reparto_local_base", "km_reparto_local_reordenado", "km_troncal_regreso"];
const orders = [], routes = [];
const limits = { Alta: 8 * 60 + 20, Media: 8 * 60 + 50, Baja: 9 * 60 + 30 };
for (const key of [...groups.keys()].sort()) {
  const group = groups.get(key).sort((a, b) => a.source.fecha_entrega - b.source.fecha_entrega || a.source.id_pedido.localeCompare(b.source.id_pedido));
  const { day, driver } = group[0], vehicle = vehicleById.get(driver.id_vehiculo);
  if (group.length > vehicle.capacidad_pedidos) throw new Error(`Capacidad superada: ${key}`);
  const city = group[0].client.zona, center = cityCenter.get(city), trunk = roadKm[city];
  const optimal = shortest(group, center), positions = new Map(optimal.map((x, i) => [x.source.id_pedido, i + 1]));
  const routeId = `RT-${iso(day).replaceAll("-", "")}-${driver.id_repartidor}`;
  let previous = center, minute = 390 + Math.round(trunk / vehicle.velocidad_promedio_kmh * 60);
  const fragments = [];
  group.forEach((item, i) => {
    const legKm = distance(previous, item.client);
    const localKm = round(legKm + (i === group.length - 1 ? distance(item.client, center) : 0));
    const allocatedTrunk = trunk * ((i === 0 ? 1 : 0) + (i === group.length - 1 ? 1 : 0));
    const km = round(localKm + allocatedTrunk), mins = Math.round(legKm / vehicle.velocidad_promedio_kmh * 60 + 8);
    const departure = new Date(day.getTime() + minute * 60000);
    minute += mins;
    const arrival = new Date(day.getTime() + minute * 60000);
    const cost = round(km / vehicle.rendimiento_km_litro * vehicle.costo_litro);
    const limit = limits[item.source.prioridad];
    const status = minute <= limit ? "Entregado" : "Retrasado";
    fragments.push({ km, mins, cost, localKm });
    orders.push([item.source.id_pedido, arrival, item.client.id_cliente, item.client.nombre_cliente, item.client.zona, item.client.latitud, item.client.longitud, driver.id_repartidor, driver.nombre_repartidor, vehicle.id_vehiculo, vehicle.tipo_vehiculo, routeId, clock(departure), clock(arrival), mins, km, cost, status, item.source.prioridad, i + 1, positions.get(item.source.id_pedido), item.source.valor_pedido, `${String(Math.floor(limit / 60)).padStart(2, "0")}:${String(limit % 60).padStart(2, "0")}`, localKm, allocatedTrunk]);
    previous = item.client;
  });
  const actualKm = round(fragments.reduce((a, x) => a + x.km, 0));
  const localActual = round(fragments.reduce((a, x) => a + x.localKm, 0));
  const localOptimal = routeLength(optimal, center);
  const optKm = round(localOptimal + trunk * 2), savingKm = round(actualKm - optKm);
  const actualCost = round(fragments.reduce((a, x) => a + x.cost, 0));
  const optCost = savingKm === 0 ? actualCost : round(optKm / vehicle.rendimiento_km_litro * vehicle.costo_litro);
  const actualMin = Math.round(actualKm / vehicle.velocidad_promedio_kmh * 60 + group.length * 8);
  const optMin = Math.round(optKm / vehicle.velocidad_promedio_kmh * 60 + group.length * 8);
  routes.push([routeId, iso(day), driver.id_repartidor, driver.nombre_repartidor, vehicle.id_vehiculo, vehicle.tipo_vehiculo, group.length, actualKm, optKm, savingKm, actualKm ? round(savingKm / actualKm * 100) : 0, actualCost, optCost, round(actualCost - optCost), actualMin, optMin, actualMin - optMin, optimal.map((x) => x.source.id_pedido).join(" > "), city, trunk, localActual, localOptimal, trunk]);
}
orders.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
const sum = (data, col) => round(data.reduce((a, row) => a + row[col], 0));
const dailyPlans = [];
const routeByDateCity = new Map(routes.map((route, i) => [`${route[1]}|${route[18]}`, { route, row: i + 2 }]));
const dates = [...new Set(routes.map((route) => route[1]))].sort();
for (const date of dates) for (const zone of proposedZones) {
  const active = zone.cities.map((city) => routeByDateCity.get(`${date}|${city}`)).filter(Boolean);
  if (!active.length) continue;
  const driver = drivers.find((item) => item.id_repartidor === zone.driver);
  const vehicle = vehicleById.get(driver.id_vehiculo);
  const baselineKm = round(active.reduce((n, x) => n + x.route[7], 0));
  const localOptimized = round(active.reduce((n, x) => n + x.route[21], 0));
  const proposedKm = round(2 * Math.max(...active.map((x) => roadKm[x.route[18]])) + localOptimized);
  const baselineCost = round(active.reduce((n, x) => n + x.route[11], 0));
  const proposedCost = round(proposedKm / vehicle.rendimiento_km_litro * fuelPerLiter);
  const baselineMin = active.reduce((n, x) => n + x.route[14], 0);
  const totalOrders = active.reduce((n, x) => n + x.route[6], 0);
  const proposedMin = Math.round(proposedKm / vehicle.velocidad_promedio_kmh * 60 + totalOrders * 8);
  dailyPlans.push({
    zone, date, driver, vehicle, active,
    values: [`PL-${date.replaceAll("-", "")}-${zone.id}`, date, zone.id, active.map((x) => x.route[18]).join(" + "), driver.id_repartidor, driver.nombre_repartidor, vehicle.id_vehiculo, totalOrders, active.map((x) => x.route[0]).join(" + "), active.length,
      round(active.reduce((n, x) => n + 2 * x.route[19], 0)), 2 * Math.max(...active.map((x) => roadKm[x.route[18]])),
      round(active.reduce((n, x) => n + x.route[20], 0)), localOptimized,
      baselineKm, proposedKm, round(baselineKm - proposedKm), baselineCost, proposedCost, round(baselineCost - proposedCost),
      baselineMin, proposedMin, baselineMin - proposedMin, vehicle.capacidad_pedidos, totalOrders <= vehicle.capacidad_pedidos ? "Sí" : "No", proposedMin <= 480 ? "Sí" : "No"],
  });
}
const dailyHeader = ["id_plan", "fecha_entrega", "zona_propuesta", "municipios_atendidos", "id_repartidor_propuesto", "nombre_repartidor_propuesto", "id_vehiculo_propuesto", "total_pedidos", "rutas_base", "cantidad_rutas_base", "km_troncal_base", "km_troncal_propuesto", "km_local_base", "km_local_propuesto", "distancia_actual_km", "distancia_optimizada_km", "ahorro_km", "costo_actual", "costo_optimizado", "ahorro_costo", "tiempo_actual_min", "tiempo_optimizado_min", "ahorro_tiempo_min", "capacidad_vehiculo", "cumple_capacidad", "cumple_jornada_8h", "lectura_ahorro_diario"];
const compareHeader = ["zona_propuesta", "municipios", "repartidor_propuesto", "vehiculo_propuesto", "pedidos", "rutas_base", "rutas_propuestas", "distancia_actual_km", "distancia_optimizada_km", "ahorro_km", "ahorro_porcentaje", "costo_actual", "costo_optimizado", "ahorro_costo", "tiempo_actual_min", "tiempo_optimizado_min", "ahorro_tiempo_min", "dias_sobre_capacidad", "dias_sobre_8h", "ahorro_salario_mensual_sup_L"];
const comparison = proposedZones.map((zone) => {
  const items = dailyPlans.filter((item) => item.zone.id === zone.id);
  const driver = drivers.find((item) => item.id_repartidor === zone.driver);
  const baseKm = round(items.reduce((n, item) => n + item.values[14], 0));
  const proposedKm = round(items.reduce((n, item) => n + item.values[15], 0));
  const baseCost = round(items.reduce((n, item) => n + item.values[17], 0));
  const proposedCost = round(items.reduce((n, item) => n + item.values[18], 0));
  const baseMin = items.reduce((n, item) => n + item.values[20], 0), proposedMin = items.reduce((n, item) => n + item.values[21], 0);
  return [zone.id, zone.cities.join(" + "), driver.nombre_repartidor, driver.id_vehiculo,
    items.reduce((n, item) => n + item.values[7], 0), items.reduce((n, item) => n + item.values[9], 0), items.length,
    baseKm, proposedKm, round(baseKm - proposedKm), round((baseKm - proposedKm) / baseKm * 100, 1),
    baseCost, proposedCost, round(baseCost - proposedCost), baseMin, proposedMin, baseMin - proposedMin,
    items.filter((item) => item.values[24] === "No").length, items.filter((item) => item.values[25] === "No").length, monthlySalaryAssumption];
});
const delivered = orders.filter((x) => x[17] === "Entregado").length;
const start = iso(serialDay(Math.min(...sourceOrders.map((x) => x.fecha_entrega))));
const end = iso(serialDay(Math.max(...sourceOrders.map((x) => x.fecha_entrega))));
const period = `${start} al ${end}`;

const wb = Workbook.create();
const dark = "#203341", wine = "#9D1A2A";
function sheet(name, header, data, widths = []) {
  const ws = wb.worksheets.add(name), n = header.length;
  ws.getRangeByIndexes(0, 0, data.length + 1, n).values = [header, ...data];
  ws.getRangeByIndexes(0, 0, data.length + 1, n).format.font = { name: "Arial", size: 10, color: dark };
  ws.getRangeByIndexes(0, 0, 1, n).format = { fill: dark, font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, rowHeight: 30 };
  widths.forEach((width, i) => ws.getRangeByIndexes(0, i, data.length + 1, 1).format.columnWidthPx = width);
  ws.freezePanes.freezeRows(1); ws.showGridLines = false;
  return ws;
}
const cities = [...new Set(clients.map((x) => x.zona))].sort();
const cityStats = cities.map((city) => { const a = orders.filter((x) => x[4] === city); return [city, a.length, a.filter((x) => x[17] === "Retrasado").length, sum(a, 21)]; });
const summary = [
  ["Periodo", period, "230 pedidos simulados", "", "Alcance", "Ida + reparto local + regreso", "", ""],
  ["Indicador", "Antes: 8 zonas", "Después: 4 zonas", "Ahorro potencial", "Base comparable", "Mismos pedidos y fechas", "", ""],
  ["Repartidores", 8, 4, 4, "Personal", "Ahorro salarial solo si se reducen puestos", "", ""],
  ["Rutas operadas", routes.length, dailyPlans.length, routes.length - dailyPlans.length, "Operación", "Una ruta por municipio vs. una por par y día", "", ""],
  ["Distancia total (km)", sum(comparison, 7), sum(comparison, 8), sum(comparison, 9), "Método", "Traslado compartido + reparto local estimado", "", ""],
  ["Combustible (L)", sum(comparison, 11), sum(comparison, 12), sum(comparison, 13), "Precio", "Diésel de septiembre 2026; escenario, no gasto histórico", "", ""],
  ["Tiempo vehículo (min)", sum(comparison, 14), sum(comparison, 15), sum(comparison, 16), "Interpretación", "Minutos sumados de vehículos; no puntualidad", "", ""],
  ["Salario mensual supuesto (L)", 8 * monthlySalaryAssumption, 4 * monthlySalaryAssumption, 4 * monthlySalaryAssumption, "Condición", "Si se reasigna personal, el ahorro salarial es cero", "", ""],
  ["Entregas a tiempo (base)", delivered, "Sin validar", "", "Límite", "Horarios de entrega propuestos requieren simulación", "", ""],
  ["Municipio", "Pedidos", "Retrasados base", "Ingresos (L)", "", "", "", ""],
  ...cityStats.map((x) => [...x, "", "", "", ""]),
];
const s = sheet("Resumen", ["DISTRIBUIDORA ATLÁNTIDA EXPRESS", "ANTES Y DESPUÉS", "", "", "SIMULACIÓN ACADÉMICA", "", "", ""], summary, [255, 190, 190, 175, 230, 390, 150, 210]);
s.getRange("A1:H1").format.fill = wine;
s.getRange("A3:D3").format = { fill: dark, font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, rowHeight: 28 };
s.getRange("B4:D9").setNumberFormat("#,##0.00");
s.getRange("A11:H11").format = { fill: dark, font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" } };
const p = sheet("Pedidos", orderHeader, orders, [100, 170, 100, 220, 145, 110, 110, 125, 175, 115, 180, 185, 110, 110, 110, 125, 145, 140, 110, 135, 165, 135, 120, 150, 180]);
p.getRange(`B2:B${orders.length + 1}`).setNumberFormat("yyyy-mm-dd hh:mm");
p.getRange(`F2:G${orders.length + 1}`).setNumberFormat("0.000000");
for (const col of ["P", "Q", "V"]) p.getRange(`${col}2:${col}${orders.length + 1}`).setNumberFormat("#,##0.00");
const r = sheet("Rutas_Base", routeHeader, routes, [200, 125, 145, 170, 130, 190, 145, 185, 210, 125, 175, 150, 175, 160, 180, 205, 190, 330, 150, 150, 200, 210, 160]);
r.getRange(`H2:Q${routes.length + 1}`).setNumberFormat("#,##0.00");
const rd = sheet("Rutas_Diarias", dailyHeader, dailyPlans.map((item) => [...item.values, ""]), [175, 125, 120, 250, 175, 205, 150, 130, 330, 135, 160, 180, 150, 165, 185, 220, 130, 160, 175, 160, 180, 210, 190, 150, 150, 150, 270]);
rd.getRange(`K2:W${dailyPlans.length + 1}`).setNumberFormat("#,##0.00");
const rc = sheet("Rutas_Comparacion", compareHeader, comparison, [125, 265, 210, 155, 115, 130, 155, 190, 220, 135, 175, 160, 175, 160, 180, 210, 185, 170, 165, 230]);
rc.getRange("H2:Q5").setNumberFormat("#,##0.00");
const c = sheet("Clientes", ["id_cliente", "nombre_cliente", "zona", "direccion_referencia", "latitud", "longitud"], clients.map((x) => [x.id_cliente, x.nombre_cliente, x.zona, x.direccion_referencia, x.latitud, x.longitud]), [120, 225, 160, 480, 135, 135]);
c.getRange(`E2:F${clients.length + 1}`).setNumberFormat("0.000000");
const v = sheet("Vehiculos", ["id_vehiculo", "tipo_vehiculo", "placa", "capacidad_pedidos", "rendimiento_km_litro", "costo_litro", "velocidad_promedio_kmh", "combustible", "km_base", "costo_base_L", "en_escenario_4_zonas", "km_propuestos", "costo_propuesto_L"], vehicles.map((x) => [x.id_vehiculo, x.tipo_vehiculo, x.placa, x.capacidad_pedidos, x.rendimiento_km_litro, x.costo_litro, x.velocidad_promedio_kmh, "Diésel", 0, 0, proposedZones.some((zone) => drivers.find((driver) => driver.id_repartidor === zone.driver)?.id_vehiculo === x.id_vehiculo) ? "Sí" : "No", 0, 0]), [140, 210, 120, 180, 220, 150, 240, 150, 155, 165, 180, 155, 190]);
const d = sheet("Repartidores", ["id_repartidor", "nombre_repartidor", "zona_base", "id_vehiculo", "km_base", "costo_base_L", "zona_propuesta", "municipios_propuestos", "km_propuestos", "costo_propuesto_L", "salario_mensual_sup_L"], drivers.map((x) => { const zone = proposedZones.find((z) => z.driver === x.id_repartidor); return [x.id_repartidor, x.nombre_repartidor, x.zona_base, x.id_vehiculo, 0, 0, zone?.id ?? "Reasignable", zone?.cities.join(" + ") ?? "Sin ruta en escenario", 0, 0, monthlySalaryAssumption]; }), [150, 220, 175, 150, 150, 190, 160, 250, 160, 180, 190]);
const param = sheet("Parametros_Operacion", ["Municipio", "Distancia carretera ida desde La Ceiba (km)", "Método", "Fuente o nota", "", "Combustible", "Dato", "Valor", "Unidad", "Fuente / vigencia"], [
  ...Object.keys(roadKm).sort().map((city, i) => [city, roadKm[city], city === "San Francisco" ? "Estimación por validar" : "Ruta a casco urbano", distanceSource[city], "", i === 0 ? "Tipo" : i === 1 ? "Precio por galón" : i === 2 ? "Litros por galón estadounidense" : i === 3 ? "Precio por litro" : i === 4 ? "Vigencia desde" : i === 5 ? "Fecha de consulta" : "", i === 0 ? "Diésel" : "", i === 0 ? "" : i === 1 ? fuelPerGallon : i === 2 ? gallonsToLiters : i === 3 ? fuelPerLiter : i === 4 ? "2026-09-14" : i === 5 ? "2026-09-17" : "", i === 1 ? "L/gal" : i === 2 ? "L/gal US" : i === 3 ? "L/litro" : "", i <= 5 ? "https://app.ahdippe.org/precios-por-galon-2/" : ""]),
  ["", "", "", "", "", "Alcance", "Compra centralizada en La Ceiba", "Precio actual aplicado como escenario a pedidos de mayo-junio; no es gasto histórico", "", ""],
  ["", "", "", "", "", "Modelo", "2 × km intermunicipal + km reparto local", "Los km locales se estiman con coordenadas de clientes × 1.25; incluyen regreso al centro operativo local", "", ""],
], [165, 280, 190, 570, 30, 160, 290, 500, 115, 530]);
param.getRange("B2:B9").setNumberFormat("0.0");
param.getRange("H3:H5").setNumberFormat("#,##0.0000");
param.getRange("F12:J14").values = [
  ["Salario mensual supuesto", "Por repartidor", monthlySalaryAssumption, "L/mes", "Supuesto didáctico editable; no representa nómina real"],
  ["Jornada máxima", "Por ruta propuesta", 480, "min/día", "Supuesto de 8 horas; no valida ventanas de entrega"],
  ["Personal", "8 base; 4 en escenario", "Ahorro solo si se reducen puestos; reasignar personal no ahorra salario", "", ""],
];
param.getRange("L1:P5").values = [["Zona", "Municipio 1", "Municipio 2", "Repartidor propuesto", "Vehículo propuesto"], ...proposedZones.map((zone) => { const driver = drivers.find((x) => x.id_repartidor === zone.driver); return [zone.id, ...zone.cities, driver.nombre_repartidor, driver.id_vehiculo]; })];
param.getRange("L1:P1").format = { fill: dark, font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, rowHeight: 30 };
for (const [col, width] of [["L", 95], ["M", 155], ["N", 160], ["O", 210], ["P", 160]]) param.getRange(`${col}1:${col}5`).format.columnWidthPx = width;
sheet("Indicadores_KPI", ["Indicador", "Valor", "Definición"], [
  ["Pedidos", orders.length, "Pedidos simulados del periodo"], ["Tasa dentro de plazo (%)", round(delivered / orders.length * 100, 1), "Según hora límite simulada por prioridad"],
  ["Distancia base (km)", sum(comparison, 7), "Ocho repartidores; rutas por municipio y día"], ["Distancia propuesta (km)", sum(comparison, 8), "Cuatro repartidores; pares de municipios próximos"],
  ["Ahorro potencial (km)", sum(comparison, 9), "Distancia base menos propuesta; ambos incluyen regreso"], ["Costo combustible base (L)", sum(comparison, 11), "Precio diésel de septiembre 2026 aplicado como escenario"],
  ["Costo combustible propuesto (L)", sum(comparison, 12), "Distancia propuesta / rendimiento del vehículo asignado × precio"], ["Ahorro combustible potencial (L)", sum(comparison, 13), "Base menos propuesto"],
  ["Repartidores base", drivers.length, "Uno por municipio en el escenario base"], ["Repartidores propuestos", proposedZones.length, "Uno por par de municipios; sin validar ventanas horarias"],
  ["Ahorro salarial mensual supuesto (L)", 4 * monthlySalaryAssumption, "Solo si se eliminan cuatro puestos; no aplica a reasignación"],
], [330, 155, 610]);
sheet("Contexto_Proyecto", ["Tema", "Descripción"], [
  ["Naturaleza", "Empresa y operación ficticias para un proyecto académico; los datos no representan una empresa real."],
  ["Periodo", period], ["Cobertura", "Ocho municipios de Atlántida. Base: ocho repartidores; propuesta: cuatro pares de municipios."],
  ["Depósito", "Sede principal simulada en La Ceiba. Distancia troncal La Ceiba→La Ceiba = 0 km."],
  ["Distancia", "Tabla de km por carretera desde La Ceiba al casco urbano + estimación local (Haversine × 1.25). San Francisco es estimación pendiente de validación."],
  ["Alcance", "Cada ruta contempla ida intermunicipal, reparto local y regreso. La Ceiba solo genera kilómetros locales."],
  ["Ruta base", "Un vehículo por municipio con pedidos cada día; conserva los ocho repartidores actuales simulados."],
  ["Ruta propuesta", "Un vehículo por par de municipios con pedidos cada día; conserva los mismos pedidos y fecha, optimiza el orden local y comparte el traslado troncal."],
  ["Días sin ahorro de km", "Si en una fecha solo hay pedidos en uno de los dos municipios y no mejora el orden local, los km antes y después son iguales. No se fuerza un ahorro artificial."],
  ["Pedidos", "Los kilómetros y el combustible asignados a cada pedido corresponden solo a la operación base. La propuesta comparte el traslado entre municipios y se calcula por ruta diaria, no por pedido."],
  ["Pares propuestos", "Carlos: La Ceiba y Jutiapa; Daniela: El Porvenir y San Francisco; María: La Masica y Esparta; Ana: Arizona y Tela."],
  ["Tramo entre municipios", "Para municipios del mismo corredor, se aproxima como diferencia de distancias desde La Ceiba. No hay medición GPS de la conexión entre cascos urbanos."],
  ["Personal", "Salario mensual L 18,000 por persona: supuesto editable. El ahorro salarial requiere reducir cuatro puestos; si se reasignan, no se materializa."],
  ["Viabilidad", "Capacidad de vehículo y jornada de ocho horas se comprueban por ruta diaria. Horarios límite de entrega del escenario propuesto no han sido validados."],
  ["Tiempo", "Rutas: distancia total / velocidad media del vehículo + 8 minutos por entrega; horario de pedido solo hasta entrega."],
  ["Combustible", "Distancia total / rendimiento del vehículo × precio diésel por litro de Parametros_Operacion. Cotización de septiembre aplicada como escenario, no gasto histórico."],
  ["Plazos", "Ventanas de entrega matutina simuladas: Alta 08:20; Media 08:50; Baja 09:30."],
  ["Límites", "Distancias intermunicipales de referencia a cascos urbanos; reparto local geométrico; sin GPS, tráfico, carga ni pausas. Precio varía semanalmente."],
  ["Interpretación", "Los ahorros son un escenario potencial, no ahorro operativo comprobado. No presentar el costo de septiembre como facturación de mayo-junio."],
  ["Procedencia", "Se conservaron IDs de pedidos y clientes, fechas de operación y valores comerciales del archivo simulado original."],
], [215, 1090]);
sheet("Diccionario", ["Campo", "Definición"], [
  ["fecha_entrega", "Fecha y hora de finalización de entrega simulada."], ["ciudad; latitud; longitud", "Municipio y coordenadas del maestro Clientes."],
  ["id_ruta", "Clave compartida entre Pedidos y Rutas_Base."], ["hora_salida; hora_llegada", "Inicio y fin del tramo de entrega base, con atención incluida."],
  ["tiempo_min", "Minutos del tramo hasta el cliente; excluye el regreso posterior a la última entrega."], ["distancia_base_asignada_km", "Kilómetros de la operación base imputados al pedido: reparto local + traslado troncal. No representa el escenario propuesto."],
  ["km_reparto_local_base", "Tramo local al cliente; el último pedido recibe además el regreso al centro local."], ["km_troncal_base_asignado", "Distancia desde La Ceiba al municipio asignada al primer pedido y retorno asignado al último; cero en La Ceiba."],
  ["costo_combustible_base_L", "Costo imputado del escenario base: kilómetros / rendimiento × precio diésel vigente; no es gasto histórico."], ["estado_entrega", "Entregado si hora_llegada no supera hora_limite; Retrasado si la supera."],
  ["prioridad; hora_limite", "Alta 08:20, Media 08:50, Baja 09:30."], ["orden_actual; orden_optimizado", "Posición del pedido en cada secuencia."],
  ["Rutas_Diarias", "Cada fecha y par de municipios muestra la suma de rutas base y una ruta conjunta propuesta, con cálculo de capacidad y jornada."],
  ["Rutas_Comparacion", "Cuatro filas, una por zona propuesta. Agrega las rutas diarias sin duplicar kilómetros ni costos."],
  ["Rutas_Base", "Solo operación base por municipio. Sus columnas de reordenación local no equivalen al escenario de cuatro zonas."],
  ["distancia_optimizada_km", "En Rutas_Diarias y Rutas_Comparacion, distancia del escenario de cuatro zonas; mismos pedidos y fechas que la base."],
  ["ahorro_km; ahorro_costo; ahorro_tiempo_min", "Valor actual menos propuesto; potencial, no resultado vial medido."],
  ["ahorro_porcentaje", "100 × ahorro_km / distancia_actual_km."],
], [410, 800]);
sheet("Empresa", ["Campo", "Valor"], [["Empresa", "Distribuidora Atlántida Express S. de R.L. de C.V. (ficticia)"], ["Giro", "Distribución simulada de abarrotes, bebidas y snacks"], ["Cobertura", "Ocho municipios de Atlántida, Honduras"], ["Uso", "Caso académico de análisis de datos y planificación logística"]], [235, 610]);

// Celdas maestras editables: cambiar distancia o precio recalcula pedidos, rutas y totales.
param.getRange("H5").formulas = [["=ROUND(H3/H4,4)"]];
const cityRow = new Map(Object.keys(roadKm).sort().map((name, i) => [name, i + 2]));
const vehicleRow = new Map(vehicles.map((item, i) => [item.id_vehiculo, i + 2]));
const formulaColumn = (ws, column, data) => { ws.getRange(`${column}2:${column}${data.length + 1}`).formulas = data; };
formulaColumn(v, "F", vehicles.map(() => ["=Parametros_Operacion!$H$5"]));
formulaColumn(v, "I", vehicles.map((_, i) => [`=SUMIF(Rutas_Base!$E$2:$E$${routes.length + 1},A${i + 2},Rutas_Base!$H$2:$H$${routes.length + 1})`]));
formulaColumn(v, "J", vehicles.map((_, i) => [`=SUMIF(Rutas_Base!$E$2:$E$${routes.length + 1},A${i + 2},Rutas_Base!$L$2:$L$${routes.length + 1})`]));
formulaColumn(v, "L", vehicles.map((_, i) => [`=SUMIF(Rutas_Diarias!$G$2:$G$${dailyPlans.length + 1},A${i + 2},Rutas_Diarias!$P$2:$P$${dailyPlans.length + 1})`]));
formulaColumn(v, "M", vehicles.map((_, i) => [`=SUMIF(Rutas_Diarias!$G$2:$G$${dailyPlans.length + 1},A${i + 2},Rutas_Diarias!$S$2:$S$${dailyPlans.length + 1})`]));
formulaColumn(d, "E", drivers.map((_, i) => [`=SUMIF(Rutas_Base!$C$2:$C$${routes.length + 1},A${i + 2},Rutas_Base!$H$2:$H$${routes.length + 1})`]));
formulaColumn(d, "F", drivers.map((_, i) => [`=SUMIF(Rutas_Base!$C$2:$C$${routes.length + 1},A${i + 2},Rutas_Base!$L$2:$L$${routes.length + 1})`]));
formulaColumn(d, "I", drivers.map((_, i) => [`=SUMIF(Rutas_Diarias!$E$2:$E$${dailyPlans.length + 1},A${i + 2},Rutas_Diarias!$P$2:$P$${dailyPlans.length + 1})`]));
formulaColumn(d, "J", drivers.map((_, i) => [`=SUMIF(Rutas_Diarias!$E$2:$E$${dailyPlans.length + 1},A${i + 2},Rutas_Diarias!$S$2:$S$${dailyPlans.length + 1})`]));
formulaColumn(d, "K", drivers.map(() => ["=Parametros_Operacion!$H$12"]));
formulaColumn(p, "Y", orders.map((row) => [`=Parametros_Operacion!$B$${cityRow.get(row[4])}*${row[24] / (roadKm[row[4]] || 1)}`]));
formulaColumn(p, "P", orders.map((_, i) => [`=ROUND(X${i + 2}+Y${i + 2},2)`]));
formulaColumn(p, "Q", orders.map((row, i) => [`=ROUND(P${i + 2}/Vehiculos!$E$${vehicleRow.get(row[9])}*Vehiculos!$F$${vehicleRow.get(row[9])},2)`]));
formulaColumn(r, "T", routes.map((row) => [`=Parametros_Operacion!$B$${cityRow.get(row[18])}`]));
formulaColumn(r, "W", routes.map((_, i) => [`=T${i + 2}`]));
formulaColumn(r, "H", routes.map((_, i) => [`=ROUND(2*T${i + 2}+U${i + 2},2)`]));
formulaColumn(r, "I", routes.map((_, i) => [`=MIN(H${i + 2},ROUND(T${i + 2}+V${i + 2}+W${i + 2},2))`]));
formulaColumn(r, "J", routes.map((_, i) => [`=ROUND(H${i + 2}-I${i + 2},2)`]));
formulaColumn(r, "K", routes.map((_, i) => [`=IF(H${i + 2}=0,0,ROUND(100*J${i + 2}/H${i + 2},2))`]));
formulaColumn(r, "L", routes.map((_, i) => [`=SUMIF(Pedidos!$L$2:$L$${orders.length + 1},A${i + 2},Pedidos!$Q$2:$Q$${orders.length + 1})`]));
formulaColumn(r, "M", routes.map((row, i) => [`=IF(J${i + 2}=0,L${i + 2},MIN(L${i + 2},ROUND(I${i + 2}/Vehiculos!$E$${vehicleRow.get(row[4])}*Vehiculos!$F$${vehicleRow.get(row[4])},2)))`]));
formulaColumn(r, "N", routes.map((_, i) => [`=ROUND(L${i + 2}-M${i + 2},2)`]));
formulaColumn(r, "O", routes.map((row, i) => [`=ROUND(H${i + 2}/Vehiculos!$G$${vehicleRow.get(row[4])}*60+G${i + 2}*8,0)`]));
formulaColumn(r, "P", routes.map((row, i) => [`=MIN(O${i + 2},ROUND(I${i + 2}/Vehiculos!$G$${vehicleRow.get(row[4])}*60+G${i + 2}*8,0))`]));
formulaColumn(r, "Q", routes.map((_, i) => [`=O${i + 2}-P${i + 2}`]));
const sumBase = (item, col) => item.active.map((x) => `Rutas_Base!${col}${x.row}`).join(",");
formulaColumn(rd, "K", dailyPlans.map((item) => [`=SUM(${item.active.flatMap((x) => [`Rutas_Base!T${x.row}`, `Rutas_Base!W${x.row}`]).join(",")})`]));
formulaColumn(rd, "L", dailyPlans.map((item) => [`=2*MAX(${item.active.map((x) => `Parametros_Operacion!$B$${cityRow.get(x.route[18])}`).join(",")})`]));
for (const [column, baseCol] of [["M", "U"], ["N", "V"], ["O", "H"], ["R", "L"], ["U", "O"]]) formulaColumn(rd, column, dailyPlans.map((item) => [`=SUM(${sumBase(item, baseCol)})`]));
formulaColumn(rd, "P", dailyPlans.map((_, i) => [`=ROUND(L${i + 2}+N${i + 2},2)`]));
formulaColumn(rd, "Q", dailyPlans.map((_, i) => [`=ROUND(O${i + 2}-P${i + 2},2)`]));
formulaColumn(rd, "S", dailyPlans.map((item, i) => [`=ROUND(P${i + 2}/Vehiculos!$E$${vehicleRow.get(item.vehicle.id_vehiculo)}*Vehiculos!$F$${vehicleRow.get(item.vehicle.id_vehiculo)},2)`]));
formulaColumn(rd, "T", dailyPlans.map((_, i) => [`=ROUND(R${i + 2}-S${i + 2},2)`]));
formulaColumn(rd, "V", dailyPlans.map((item, i) => [`=ROUND(P${i + 2}/Vehiculos!$G$${vehicleRow.get(item.vehicle.id_vehiculo)}*60+H${i + 2}*8,0)`]));
formulaColumn(rd, "W", dailyPlans.map((_, i) => [`=U${i + 2}-V${i + 2}`]));
formulaColumn(rd, "X", dailyPlans.map((item) => [`=Vehiculos!$D$${vehicleRow.get(item.vehicle.id_vehiculo)}`]));
formulaColumn(rd, "Y", dailyPlans.map((_, i) => [`=IF(H${i + 2}<=X${i + 2},"Sí","No")`]));
formulaColumn(rd, "Z", dailyPlans.map((_, i) => [`=IF(V${i + 2}<=Parametros_Operacion!$H$13,"Sí","No")`]));
formulaColumn(rd, "AA", dailyPlans.map((_, i) => [`=IF(Q${i + 2}>0,"Ahorro por ruta compartida","Sin ahorro: recorrido equivalente")`]));
const planEnd = dailyPlans.length + 1;
const zoneSum = (col, row) => `=SUMIF(Rutas_Diarias!$C$2:$C$${planEnd},A${row},Rutas_Diarias!$${col}$2:$${col}$${planEnd})`;
for (const [target, source] of [["E", "H"], ["F", "J"], ["H", "O"], ["I", "P"], ["L", "R"], ["M", "S"], ["O", "U"], ["P", "V"]]) formulaColumn(rc, target, proposedZones.map((_, i) => [zoneSum(source, i + 2)]));
formulaColumn(rc, "G", proposedZones.map((_, i) => [`=COUNTIF(Rutas_Diarias!$C$2:$C$${planEnd},A${i + 2})`]));
formulaColumn(rc, "J", proposedZones.map((_, i) => [`=ROUND(H${i + 2}-I${i + 2},2)`]));
formulaColumn(rc, "K", proposedZones.map((_, i) => [`=ROUND(100*J${i + 2}/H${i + 2},1)`]));
formulaColumn(rc, "N", proposedZones.map((_, i) => [`=ROUND(L${i + 2}-M${i + 2},2)`]));
formulaColumn(rc, "Q", proposedZones.map((_, i) => [`=O${i + 2}-P${i + 2}`]));
formulaColumn(rc, "R", proposedZones.map((_, i) => [`=COUNTIFS(Rutas_Diarias!$C$2:$C$${planEnd},A${i + 2},Rutas_Diarias!$Y$2:$Y$${planEnd},"No")`]));
formulaColumn(rc, "S", proposedZones.map((_, i) => [`=COUNTIFS(Rutas_Diarias!$C$2:$C$${planEnd},A${i + 2},Rutas_Diarias!$Z$2:$Z$${planEnd},"No")`]));
formulaColumn(rc, "T", proposedZones.map(() => ["=Parametros_Operacion!$H$12"]));
const kpi = wb.worksheets.getItem("Indicadores_KPI");
for (const [cell, col] of [["B4", "H"], ["B5", "I"], ["B6", "J"], ["B7", "L"], ["B8", "M"], ["B9", "N"], ["B12", "T"]]) kpi.getRange(cell).formulas = [[`=SUM(Rutas_Comparacion!${col}2:${col}5)`]];
for (const [row, before, after, saving] of [[5, "F", "G", null], [6, "H", "I", "J"], [7, "L", "M", "N"], [8, "O", "P", "Q"]]) {
  s.getRange(`B${row}:D${row}`).formulas = [[`=SUM(Rutas_Comparacion!${before}2:${before}5)`, `=SUM(Rutas_Comparacion!${after}2:${after}5)`, saving ? `=SUM(Rutas_Comparacion!${saving}2:${saving}5)` : `=B${row}-C${row}`]];
}
s.getRange("B4:D4").formulas = [["=COUNTA(Repartidores!A2:A9)", "=COUNTA(Parametros_Operacion!L2:L5)", "=B4-C4"]];
s.getRange("B9:D9").formulas = [["=B4*Parametros_Operacion!$H$12", "=C4*Parametros_Operacion!$H$12", "=B9-C9"]];
s.getRange("B10").formulas = [[`=COUNTIF(Pedidos!R2:R${orders.length + 1},"Entregado")`]];

// Prueba de sensibilidad en memoria: restaura los tres controles antes de exportar.
wb.recalculate();
const originalTela = param.getRange("B9").values[0][0];
const originalFuel = param.getRange("H3").values[0][0];
const originalSalary = param.getRange("H12").values[0][0];
const startingKm = rc.getRange("I5").values[0][0];
const startingFuel = rc.getRange("M5").values[0][0];
param.getRange("B9").values = [[originalTela + 1]];
wb.recalculate();
if (!(rc.getRange("I5").values[0][0] > startingKm)) throw new Error("La distancia propuesta no responde a la tabla de municipios");
param.getRange("B9").values = [[originalTela]];
param.getRange("H3").values = [[originalFuel + 1]];
wb.recalculate();
if (!(rc.getRange("M5").values[0][0] > startingFuel)) throw new Error("El costo propuesto no responde al precio del diésel");
param.getRange("H3").values = [[originalFuel]];
param.getRange("H12").values = [[originalSalary + 1000]];
wb.recalculate();
if (rc.getRange("T2").values[0][0] !== originalSalary + 1000) throw new Error("El ahorro salarial no responde al supuesto mensual");
param.getRange("H12").values = [[originalSalary]];
wb.recalculate();
console.log((await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!", options: { useRegex: true, maxResults: 50 }, maxChars: 2000 })).ndjson);
for (const name of ["Resumen", "Pedidos", "Rutas_Comparacion", "Rutas_Diarias", "Parametros_Operacion", "Contexto_Proyecto"]) {
  const preview = await wb.render({ sheetName: name, range: name === "Resumen" ? "A1:H19" : name === "Contexto_Proyecto" ? "A1:B19" : name === "Parametros_Operacion" ? "A1:J14" : "A1:J8", scale: 1.2, format: "png" });
  await fs.writeFile(`/tmp/atlantida-nuevo-${name}.png`, new Uint8Array(await preview.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(outputPath);
console.log(JSON.stringify({ outputPath, orders: orders.length, baseRoutes: routes.length, proposedRoutes: dailyPlans.length, deliveredBase: delivered, baseKm: sum(comparison, 7), proposedKm: sum(comparison, 8), savingKm: sum(comparison, 9), baseFuelCost: sum(comparison, 11), proposedFuelCost: sum(comparison, 12), fuelSaving: sum(comparison, 13) }));
