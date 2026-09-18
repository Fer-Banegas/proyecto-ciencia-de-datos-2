import { useEffect, useState } from "react";
import { calculateSimulator, downloadSimulatorReport, getSimulatorSource, importSimulatorFile } from "./api";

const numeric = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 });
const cash = new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 2 });
const cashExact = new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const copy = (data) => JSON.parse(JSON.stringify(data));
const defaultInactiveKey = "atlantida-default-inactive-drivers";

function defaultVehicleStates(data, zones) {
  const used = new Set(zones.map((zone) => zone.vehicle_id));
  const reserve = data.vehicles.find((vehicle) => !used.has(vehicle.id));
  return Object.fromEntries(data.vehicles.map((vehicle) => [vehicle.id, vehicle.id === reserve?.id ? "reserve" : "available"]));
}

function ThreeWayComparison({ result }) {
  const formatDate = (value) => new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  const rows = [
    { label: "Kilómetros recorridos", key: "kilometers", format: (value) => `${numeric.format(value)} km` },
    { label: "Rutas realizadas", key: "routes", format: numeric.format },
    { label: "Repartidores utilizados", key: "drivers", format: numeric.format },
    { label: "Vehículos en ruta", key: "vehicles", format: numeric.format },
    { label: "Combustible", key: "fuel_cost", format: cashExact.format },
    { label: "Salarios (supuesto)", key: "salary", format: cashExact.format },
    { label: "Total estimado: combustible + salarios", key: "total_cost", format: cashExact.format, total: true },
  ];
  const delta = (previous, current, format) => {
    const saving = Math.round((previous - current) * 100) / 100;
    const percentage = previous ? Math.abs(saving / previous * 100) : 0;
    return <span className={saving > 0 ? "sim-positive" : saving < 0 ? "sim-negative" : ""}>
      {saving === 0 ? "Sin cambio" : `${format(Math.abs(saving))} ${saving > 0 ? "menos" : "más"}`}
      {saving !== 0 && <small>{numeric.format(percentage)}%</small>}
    </span>;
  };
  if (!result.reference) return <div className="sim-note">No se pudo generar una propuesta automática comparable para este Excel. El resultado anterior sí contrasta tu simulación con la operación base.</div>;
  return <section className="sim-three-way">
    <div className="panel-heading"><div><span>TRES ESCENARIOS · MISMA FUENTE</span><h2>Balance comparativo</h2><p>Del {formatDate(result.start_date)} al {formatDate(result.end_date)}. La base es la operación original; «Sistema» usa la propuesta automática del Excel activo.</p></div></div>
    <div className="table-scroll"><table><thead><tr><th>Concepto</th><th>Análisis de datos<br/>Base</th><th>Optimización<br/>Sistema</th><th className="sim-scenario-column">Tu simulación</th><th>Tu simulación<br/>vs. base</th><th>Tu simulación<br/>vs. sistema</th></tr></thead><tbody>
      {rows.filter((row) => !row.total).map((row) => <tr key={row.key}><td><strong>{row.label}</strong></td><td>{row.format(result[row.key].before)}</td><td>{row.format(result.reference[row.key].after)}</td><td className="sim-scenario-column"><strong>{row.format(result[row.key].after)}</strong></td><td>{delta(result[row.key].before, result[row.key].after, row.format)}</td><td>{delta(result.reference[row.key].after, result[row.key].after, row.format)}</td></tr>)}
    </tbody><tfoot>{rows.filter((row) => row.total).map((row) => <tr key={row.key}><th>{row.label}</th><td>{row.format(result[row.key].before)}</td><td>{row.format(result.reference[row.key].after)}</td><td className="sim-scenario-column">{row.format(result[row.key].after)}</td><td>{delta(result[row.key].before, result[row.key].after, row.format)}</td><td>{delta(result.reference[row.key].after, result[row.key].after, row.format)}</td></tr>)}</tfoot></table></div>
    <p className="sim-comparison-note">Los salarios se estiman con {cashExact.format(result.salary_monthly_assumed)} mensuales por repartidor y se prorratean por días calendario. El ahorro salarial y el total requieren reducir puestos; si el personal se reasigna, ese ahorro salarial es cero. «Vehículos en ruta» es un conteo, no un ahorro monetario: la reserva y los vehículos fuera del escenario no reducen costos fijos por sí solos. No incluye prestaciones, mantenimiento ni otros gastos.{Math.abs(result.fuel_price_scenario - result.fuel_price_source) > 0.0001 ? " Cambiaste el precio del diésel: la diferencia de combustible combina precio y rutas." : ""}</p>
  </section>;
}

function Metric({ title, item, formatter, unit }) {
  const saving = item.saving >= 0;
  return <article className="sim-metric">
    <span>{title}</span><div className="sim-metric-pair"><small>Antes <strong>{formatter(item.before)}{unit}</strong></small><small>Después <strong>{formatter(item.after)}{unit}</strong></small></div>
    <strong className={saving ? "sim-positive" : "sim-negative"}>{saving ? "Ahorro" : "Aumento"}: {formatter(Math.abs(item.saving))}{unit}</strong>
    <small>{Math.abs(item.percent).toFixed(2)}% {saving ? "menos" : "más"} que la base</small>
  </article>;
}

function ZoneBars({ zones }) {
  const max = Math.max(1, ...zones.map((zone) => zone.before_km));
  return <div className="sim-zone-bars">
    {zones.map((zone) => <div key={zone.id} className="sim-zone-bar">
      <div><strong>{zone.id}</strong><span>{zone.municipalities.join(" + ")}</span></div>
      <div className="sim-bar-lines">
        <div><small>Antes</small><i><b style={{width: `${zone.before_km / max * 100}%`}}/></i><strong>{numeric.format(zone.before_km)} km</strong></div>
        <div><small>Después</small><i><b style={{width: `${zone.after_km / max * 100}%`}}/></i><strong>{numeric.format(zone.after_km)} km</strong></div>
      </div>
    </div>)}
  </div>;
}

export default function Simulator() {
  const [source, setSource] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [zones, setZones] = useState([]);
  const [fuel, setFuel] = useState(0);
  const [newName, setNewName] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDriverId, setPendingDriverId] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [vehicleStates, setVehicleStates] = useState({});
  const roster = source ? [
    ...source.drivers.map((original) => drivers.find((person) => person.id === original.id) || { ...original, active: false }),
    ...drivers.filter((person) => !source.drivers.some((original) => original.id === person.id)),
  ] : [];
  const activeDrivers = roster.filter((person) => person.active !== false);
  const pendingDriver = roster.find((person) => person.id === pendingDriverId);
  const pendingZones = zones.filter((zone) => zone.driver_id === pendingDriverId);
  const uncoveredZones = zones.filter((zone) => !zone.driver_id);
  const assignedVehicleIds = new Set(zones.map((zone) => zone.vehicle_id).filter(Boolean));
  const availableVehicles = source?.vehicles.filter((vehicle) => !assignedVehicleIds.has(vehicle.id) && vehicleStates[vehicle.id] === "available") || [];
  const vehicleWithoutAssignment = zones.filter((zone) => !zone.vehicle_id);

  const activate = (data) => {
    let inactiveIds = [];
    if (data.source_id === "default") {
      try {
        const saved = JSON.parse(localStorage.getItem(defaultInactiveKey));
        // Recupera los dos repartidores que se quitaron antes de existir el estado inactivo.
        inactiveIds = Array.isArray(saved) ? saved : ["R006", "R008"];
      } catch { inactiveIds = ["R006", "R008"]; }
    }
    setSource(data); setDrivers(copy(data.drivers).map((person) => ({ ...person, active: !inactiveIds.includes(person.id) })));
    const initialZones = copy(data.zones).map((zone) => inactiveIds.includes(zone.driver_id) ? { ...zone, driver_id: "" } : zone);
    setZones(initialZones);
    setVehicleStates(defaultVehicleStates(data, initialZones));
    setPendingDriverId(null);
    setConfirmReset(false);
    setFuel(data.fuel_price); setResult(null); setMessage("");
  };
  useEffect(() => { getSimulatorSource().then(activate).catch((err) => setMessage(err.message)); }, []);
  const changeZones = (next) => { setZones(next); setResult(null); setMessage(""); };
  const payload = () => ({ source_id: source.source_id, drivers: activeDrivers.map(({ active, ...person }) => person), zones, fuel_price: Number(fuel), vehicle_states: vehicleStates });

  const upload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 15 * 1024 * 1024) {
      setMessage("Selecciona un Excel .xlsx de hasta 15 MB."); return;
    }
    setBusy(true); setMessage("");
    try { activate(await importSimulatorFile(file)); }
    catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const calculate = async () => {
    setBusy(true); setMessage(""); setResult(null);
    try { setResult(await calculateSimulator(payload())); }
    catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };
  const report = async () => {
    setBusy(true); setMessage("");
    try {
      const blob = await downloadSimulatorReport(payload());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = "atlantida-comparacion.pdf"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  };

  const updateZone = (index, key, value) => changeZones(zones.map((zone, i) => i === index ? { ...zone, [key]: value } : zone));
  const moveVehicleToZone = (vehicleId, targetZoneId) => {
    const current = zones.find((zone) => zone.vehicle_id === vehicleId);
    const target = zones.find((zone) => zone.id === targetZoneId);
    if (!current || !target || current.id === target.id) return;
    changeZones(zones.map((zone) => zone.id === target.id ? { ...zone, vehicle_id: vehicleId } : zone.id === current.id ? { ...zone, vehicle_id: target.vehicle_id } : zone));
  };
  const changeVehicleState = (vehicleId, state) => {
    if (assignedVehicleIds.has(vehicleId)) return;
    setVehicleStates((current) => ({ ...current, [vehicleId]: state }));
    setResult(null);
  };
  const resetReference = () => {
    const referenceZones = copy(source.zones);
    const referenceDrivers = new Set(referenceZones.map((zone) => zone.driver_id));
    const nextDrivers = copy(source.drivers).map((person) => ({ ...person, active: referenceDrivers.has(person.id) }));
    setZones(referenceZones);
    setDrivers(nextDrivers);
    setVehicleStates(defaultVehicleStates(source, referenceZones));
    setFuel(source.fuel_price);
    setNewName(""); setResult(null); setMessage(""); setPendingDriverId(null); setConfirmReset(false);
    if (source.source_id === "default") localStorage.setItem(defaultInactiveKey, JSON.stringify(nextDrivers.filter((person) => !person.active).map((person) => person.id)));
  };
  const toggleDriver = (person) => {
    const next = drivers.some((item) => item.id === person.id)
      ? drivers.map((item) => item.id === person.id ? { ...item, active: item.active === false } : item)
      : [...drivers, { ...person, active: true }];
    setDrivers(next); setResult(null);
    if (source.source_id === "default") localStorage.setItem(defaultInactiveKey, JSON.stringify(next.filter((item) => item.active === false && source.drivers.some((original) => original.id === item.id)).map((item) => item.id)));
  };
  const requestDriverToggle = (person) => {
    if (person.active !== false && zones.some((zone) => zone.driver_id === person.id)) {
      setPendingDriverId(person.id);
      return;
    }
    toggleDriver(person);
  };
  const confirmDeactivation = () => {
    if (!pendingDriver) return;
    changeZones(zones.map((zone) => zone.driver_id === pendingDriver.id ? { ...zone, driver_id: "" } : zone));
    toggleDriver(pendingDriver);
    setPendingDriverId(null);
  };
  const toggleCity = (index, city) => {
    changeZones(zones.map((zone, i) => {
      if (i === index) return { ...zone, municipalities: zone.municipalities.includes(city) ? zone.municipalities.filter((x) => x !== city) : [...zone.municipalities, city] };
      return { ...zone, municipalities: zone.municipalities.filter((x) => x !== city) };
    }));
  };
  const addDriver = () => {
    const name = newName.trim();
    if (!name) return;
    const ids = new Set(drivers.map((x) => x.id)); let index = 1;
    while (ids.has(`N${String(index).padStart(3, "0")}`)) index++;
    setDrivers([...drivers, { id: `N${String(index).padStart(3, "0")}`, name, vehicle_id: "", base_city: "Nuevo", active: true }]);
    setNewName(""); setResult(null);
  };
  const addZone = () => {
    const cities = source.municipalities.filter((city) => !zones.some((zone) => zone.municipalities.includes(city)));
    const taken = new Set(zones.map((zone) => zone.driver_id));
    const available = activeDrivers.find((person) => !taken.has(person.id));
    const vehicle = availableVehicles[0];
    const ids = new Set(zones.map((zone) => zone.id)); let n = 1; while (ids.has(`Z${n}`)) n++;
    changeZones([...zones, { id: `Z${n}`, municipalities: cities.slice(0, 1), driver_id: available?.id || "", vehicle_id: vehicle?.id || "" }]);
  };

  if (!source) return <div className="page-stack"><section className="page-heading"><div><span className="eyebrow">LABORATORIO DE RUTAS</span><h1>Simulador de escenarios</h1></div></section><section className="panel">{message || "Preparando los datos del proyecto…"}</section></div>;

  return <div className="page-stack simulator">
    <section className="page-heading"><div><span className="eyebrow">LABORATORIO DE RUTAS</span><h1>Diseña una ruta, <em>mide el cambio.</em></h1><p>Conservamos el Excel y los pedidos originales. Modifica solo la propuesta y compara cada escenario contra la misma base.</p></div></section>

    <section className="panel sim-step"><div className="panel-heading"><div><span>PASO 1 · FUENTE</span><h2>Datos del Excel</h2></div></div>
      <div className="sim-source"><div><strong>{source.filename}</strong><p>{source.orders} pedidos · {source.municipalities.length} municipios · {source.format}</p></div><label className="sim-upload">{busy ? "Procesando…" : "Cargar otro Excel"}<input type="file" accept=".xlsx" disabled={busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
      <p className="sim-help">Admite el archivo original Atlántida y la copia preparada con el mismo esquema. Un archivo vacío o incompatible se rechaza sin reemplazar la fuente activa.</p>
      {source.notes.map((note, i) => <p className="sim-note" key={i}>{note}</p>)}
    </section>

    <section className="panel sim-step"><div className="panel-heading"><div><span>PASO 2 · RECURSOS</span><h2>Equipo y combustible</h2></div></div>
      <div className="sim-field"><label htmlFor="sim-fuel">Precio simulado del diésel (L por litro)</label><input id="sim-fuel" type="number" min="0.01" max="1000" step="0.01" value={fuel} onChange={(e) => {setFuel(e.target.value); setResult(null);}} /><small>Precio del archivo: L {numeric.format(source.fuel_price)}. Si lo cambias, el efecto del precio se suma al de las rutas.</small></div>
      <section className="sim-team" aria-labelledby="sim-team-title"><h2 id="sim-team-title">Repartidores del escenario</h2>
        <div className="sim-add-block"><h3>Agregar nuevo repartidor</h3><div className="sim-add"><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del nuevo repartidor" aria-label="Nombre del nuevo repartidor" maxLength={90}/><button type="button" onClick={addDriver}>Agregar repartidor</button></div></div>
        <p className="sim-help">{activeDrivers.length} activos · {roster.length - activeDrivers.length} inactivos. Ningún cambio borra personas del Excel.</p><div className="sim-chips">{roster.map((person) => {
        const active = person.active !== false;
        const assigned = zones.some((zone) => zone.driver_id === person.id);
        return <div key={person.id} className={`sim-person ${active ? "" : "inactive"}`}><span className="sim-person-identity"><span>{person.name} <small>{person.id}</small></span>{assigned && <small className="sim-person-assigned" title="Atiende una zona del escenario">Asignado</small>}</span><button type="button" className="sim-status-switch" role="switch" aria-checked={active} aria-label={`${person.name}: ${active ? "activo" : "inactivo"}${assigned ? ", asignado a una zona" : ""}`} title={active && assigned ? "Mostrar advertencia antes de dejar su zona descubierta" : active ? "Desactivar en este escenario" : "Activar en este escenario"} onClick={() => requestDriverToggle(person)}><span className="sim-switch-track" aria-hidden="true"><i/></span><span>{active ? "Activo" : "Inactivo"}</span></button></div>;
      })}</div>
        {pendingDriver && <div className="sim-deactivation-alert" role="alert"><strong>¿Desactivar a {pendingDriver.name}?</strong><p>Esta acción dejará sin repartidor {pendingZones.length === 1 ? "la zona" : "las zonas"} {pendingZones.map((zone) => zone.id).join(", ")} y los siguientes municipios quedarán sin cobertura:</p><ul>{pendingZones.map((zone) => <li key={zone.id}><strong>{zone.id}:</strong> {zone.municipalities.join(", ")}</li>)}</ul><div><button type="button" onClick={() => setPendingDriverId(null)}>Cancelar</button><button type="button" className="sim-confirm-deactivation" onClick={confirmDeactivation}>Sí, desactivar</button></div></div>}
        {uncoveredZones.length > 0 && <div className="sim-uncovered-alert" role="alert"><strong>{uncoveredZones.length === 1 ? "Zona sin repartidor" : "Zonas sin repartidor"}</strong><p>Reasigna un repartidor activo en el paso 3 antes de calcular el escenario.</p><ul>{uncoveredZones.map((zone) => <li key={zone.id}><strong>{zone.id}:</strong> {zone.municipalities.join(", ")}</li>)}</ul></div>}
        <p className="sim-help">«Asignado» significa que atiende una zona en el paso 3. Puedes inactivarlo tras confirmar la advertencia; sus municipios permanecerán visibles hasta que reasignes la zona. Nadie se borra del Excel.</p></section>
      <section className="sim-fleet" aria-labelledby="sim-fleet-title"><div className="sim-fleet-heading"><div><h2 id="sim-fleet-title">Flota del escenario</h2><p className="sim-help">{assignedVehicleIds.size} en ruta · {source.vehicles.filter((vehicle) => !assignedVehicleIds.has(vehicle.id) && vehicleStates[vehicle.id] === "reserve").length} de reserva · {source.vehicles.filter((vehicle) => !assignedVehicleIds.has(vehicle.id) && vehicleStates[vehicle.id] === "inactive").length} fuera del escenario.</p></div></div>
        <div className="sim-fleet-grid">{source.vehicles.map((vehicle) => { const assigned = zones.find((zone) => zone.vehicle_id === vehicle.id); const state = assigned ? "assigned" : vehicleStates[vehicle.id] || "available"; return <article className="sim-vehicle" key={vehicle.id}><div className="sim-vehicle-top"><strong>{vehicle.id}</strong><span className={`sim-vehicle-badge ${state}`}>{state === "assigned" ? `En ruta · ${assigned.id}` : state === "reserve" ? "Reserva" : state === "inactive" ? "Fuera del escenario" : "Disponible"}</span></div><span>{vehicle.name}</span><small>{numeric.format(vehicle.efficiency)} km/L · {vehicle.capacity} pedidos · {numeric.format(vehicle.speed)} km/h</small>{assigned ? <label>Zona asignada<select value={assigned.id} onChange={(event) => moveVehicleToZone(vehicle.id, event.target.value)} aria-label={`Zona asignada a ${vehicle.id}`}>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.id} · {zone.municipalities.join(" + ") || "Sin municipios"}</option>)}</select></label> : <label>Estado<select value={state} onChange={(event) => changeVehicleState(vehicle.id, event.target.value)} aria-label={`Estado de ${vehicle.id}`}><option value="available">Disponible</option><option value="reserve">Reserva</option><option value="inactive">Fuera del escenario</option></select></label>}</article>; })}</div>
        <p className="sim-help">Al elegir otra zona para un vehículo en ruta, intercambia su lugar con el vehículo que ya estaba allí. Para ponerlo en reserva o fuera del escenario, sustitúyelo primero por uno disponible en el paso 3.</p>
        <p className="sim-help">La reserva queda lista para una contingencia, pero no participa en el cálculo. Un vehículo fuera del escenario tampoco se borra del Excel. Solo cambian los costos de combustible cuando cambian los kilómetros, el precio o el rendimiento del vehículo utilizado; no se atribuye ahorro por estacionar vehículos.</p>
      </section>
    </section>

    <section className="panel sim-step"><div className="panel-heading"><div><span>PASO 3 · DISTRIBUCIÓN</span><h2>Zonas propuestas</h2></div><div className="sim-zone-heading-actions"><button type="button" className="sim-reset-button" onClick={() => setConfirmReset(true)}>Restablecer 4 zonas</button><button type="button" onClick={addZone} disabled={zones.length >= 16}>Agregar zona</button></div></div>
      {confirmReset && <div className="sim-reset-confirm" role="alert"><strong>¿Restablecer la propuesta del sistema?</strong><p>Se recuperarán las cuatro zonas, sus cuatro repartidores y vehículos, y el precio del diésel del Excel activo. Se descartarán los cambios de esta simulación; el Excel no se modificará.</p><div><button type="button" onClick={() => setConfirmReset(false)}>Cancelar</button><button type="button" className="sim-confirm-reset" onClick={resetReference}>Sí, restablecer</button></div></div>}
      <p className="sim-help">Cada municipio debe aparecer una sola vez. Cada zona usa un repartidor y un vehículo distintos. Solo los vehículos «Disponibles» pueden asignarse; cambia el estado de una reserva antes de usarla.</p>
      <div className="sim-zone-grid">{zones.map((zone, index) => <article key={zone.id} className="sim-zone-edit"><div className="sim-zone-title"><strong>{zone.id}</strong><button type="button" onClick={() => changeZones(zones.filter((_, i) => i !== index))} disabled={zones.length <= 1}>Eliminar zona</button></div>
        <div className="sim-city-options">{source.municipalities.map((city) => <label key={city}><input type="checkbox" checked={zone.municipalities.includes(city)} onChange={() => toggleCity(index, city)} />{city}</label>)}</div>
        <label className={`sim-select ${zone.driver_id ? "" : "sim-select-uncovered"}`}>Repartidor{!zone.driver_id && <small>Sin asignar: {zone.municipalities.join(", ")}</small>}<select value={zone.driver_id} onChange={(e) => updateZone(index, "driver_id", e.target.value)}><option value="">Seleccionar</option>{activeDrivers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className={`sim-select ${zone.vehicle_id ? "" : "sim-select-uncovered"}`}>Vehículo{!zone.vehicle_id && <small>Zona sin vehículo</small>}<select value={zone.vehicle_id} onChange={(e) => updateZone(index, "vehicle_id", e.target.value)}><option value="">Seleccionar</option>{source.vehicles.filter((vehicle) => vehicle.id === zone.vehicle_id || availableVehicles.some((item) => item.id === vehicle.id)).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.id} · {vehicle.name} ({vehicle.capacity} pedidos, {vehicle.efficiency} km/L)</option>)}</select></label>
      </article>)}</div>
      <div className="sim-actions"><button type="button" className="sim-primary" disabled={busy || uncoveredZones.length > 0 || vehicleWithoutAssignment.length > 0} onClick={calculate}>{busy ? "Calculando…" : "Calcular escenario"}</button><span>Municipios asignados: {new Set(zones.flatMap((zone) => zone.municipalities)).size} de {source.municipalities.length}{uncoveredZones.length > 0 ? ` · ${uncoveredZones.length} zona(s) sin repartidor` : ""}{vehicleWithoutAssignment.length > 0 ? ` · ${vehicleWithoutAssignment.length} zona(s) sin vehículo` : ""}</span></div>
      {message && <p className="sim-error" role="alert">{message}</p>}
    </section>

    {result && <section className="panel sim-results"><div className="panel-heading"><div><span>PASO 4 · RESULTADO</span><h2>Comparación de escenarios</h2></div><button type="button" onClick={report} disabled={busy}>Descargar reporte PDF</button></div>
      <div className="sim-metrics"><Metric title="Recorrido" item={result.kilometers} formatter={numeric.format} unit=" km"/><Metric title="Costo de combustible" item={result.fuel_cost} formatter={cash.format} unit=""/><Metric title="Rutas del período" item={result.routes} formatter={numeric.format} unit=""/><Metric title="Repartidores utilizados" item={result.drivers} formatter={numeric.format} unit=""/></div>
      <ThreeWayComparison result={result}/>
      <div className="sim-visual"><h3>Distancia por zona: antes y después</h3><ZoneBars zones={result.zones}/></div>
      <div className="table-scroll"><table><thead><tr><th>Zona</th><th>Municipios</th><th>Repartidor</th><th>Vehículo</th><th>Km antes</th><th>Km después</th><th>Ahorro / aumento</th><th>Combustible antes</th><th>Combustible después</th></tr></thead><tbody>{result.zones.map((zone) => <tr key={zone.id}><td>{zone.id}</td><td>{zone.municipalities.join(" + ")}</td><td>{zone.driver}</td><td>{zone.vehicle_id}</td><td>{numeric.format(zone.before_km)}</td><td>{numeric.format(zone.after_km)}</td><td>{numeric.format(zone.delta_km)}</td><td>{cash.format(zone.before_cost)}</td><td>{cash.format(zone.after_cost)}</td></tr>)}</tbody></table></div>
      {result.warnings.length > 0 && <div className="sim-warning"><strong>Advertencias de capacidad o jornada</strong>{result.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      <div className="sim-note"><strong>Método:</strong> {result.method} La simulación no valida tráfico, rutas GPS ni ventanas de entrega.</div>
      {result.notes.map((note, i) => <p className="sim-help" key={i}>{note}</p>)}
    </section>}
  </div>;
}
