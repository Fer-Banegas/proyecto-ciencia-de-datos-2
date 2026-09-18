import { useEffect, useMemo, useRef, useState } from "react";
import { getDashboard, getMetadata, getQuality, getRouteScenario } from "./api";
import Simulator from "./Simulator";

const icons = {
  overview: "M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z",
  operation: "M3 6h18M7 6V4m10 2V4M5 10h14v10H5V10Zm3 3h3m2 0h3m-8 4h3m2 0h3",
  quality: "m4 12 5 5L20 6M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z",
  optimize: "M4 18V8m0 0 3 3M4 8 1 11m19 3V4m0 0-3 3m3-3 3 3M8 20h8",
  about: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-10h.01",
};

function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  );
}

const money = new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", maximumFractionDigits: 0 });
const moneyExact = new Intl.NumberFormat("es-HN", { style: "currency", currency: "HNL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 1 });

function Sidebar({ view, setView, open, setOpen }) {
  const items = [
    ["overview", "Dashboard"],
    ["operation", "Análisis de datos"],
    ["optimize", "Optimización (Sistema)"],
    ["simulator", "Simulador"],
    ["quality", "Calidad de Datos"],
    ["about", "Acerca del proyecto"],
  ];
  return (
    <>
      <aside className={`sidebar ${open ? "" : "closed"}`}>
        <div className="brand">
          <div className="brand-mark"><span>A</span></div>
          <div><strong>ATLÁNTIDA</strong><small>ANALYTICS</small></div>
        </div>
        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <nav>
          {items.map(([key, label]) => (
            <button key={key} className={view === key ? "active" : ""} onClick={() => { setView(key); if (window.innerWidth < 900) setOpen(false); }}>
              <Icon name={key === "simulator" ? "optimize" : key} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className="status-dot" />
          <div><strong>Fuente de datos</strong><small>Archivo operativo</small></div>
        </div>
      </aside>
      <button className={`sidebar-toggle ${open ? "" : "closed"}`} onClick={() => setOpen(!open)} aria-label="Abrir o cerrar menú">☰</button>
    </>
  );
}

function Header({ period, setPeriod, periods, theme, setTheme, zoom, setZoom, onAbout, onExit, showPeriod = true }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => { if (!profileRef.current?.contains(event.target)) setProfileOpen(false); };
    const closeEscape = (event) => { if (event.key === "Escape") setProfileOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, []);
  return (
    <header className="topbar">
      <div className="breadcrumb"><span>Atlántida Express</span><b>/</b><strong>Centro de análisis</strong></div>
      <div className="top-actions">
        {showPeriod && (
          <label className="period-select">
            <span>Periodo</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">Todo el periodo</option>
              {periods.map((item) => <option key={item} value={item}>{new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${item}-01T00:00:00Z`))}</option>)}
            </select>
          </label>
        )}
        <div className="zoom-control" role="group" aria-label="Tamaño de la interfaz">
          <span>Vista</span>
          <button type="button" onClick={() => setZoom(Math.max(90, zoom - 10))} disabled={zoom <= 90} aria-label="Reducir tamaño de la interfaz">−</button>
          <strong aria-live="polite">{zoom}%</strong>
          <button type="button" onClick={() => setZoom(Math.min(130, zoom + 10))} disabled={zoom >= 130} aria-label="Aumentar tamaño de la interfaz">+</button>
        </div>
        <button className="theme-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Cambiar tema">{theme === "light" ? "☾" : "☀"}</button>
        <div className="profile-menu-wrap" ref={profileRef}>
          <button type="button" className="profile" onClick={() => setProfileOpen(!profileOpen)} aria-haspopup="menu" aria-expanded={profileOpen} aria-label="Abrir menú de perfil">
            <span className="profile-avatar">FB</span><span className="profile-name"><strong>Fernando</strong><small>Analista</small></span><span aria-hidden="true">⌄</span>
          </button>
          {profileOpen && <div className="profile-menu" role="menu">
            <div className="profile-menu-heading"><strong>Fernando</strong><small>Modo demostración · sin autenticación</small></div>
            <button type="button" role="menuitem" onClick={() => { setZoom(110); setTheme("light"); setProfileOpen(false); }}>Restablecer apariencia</button>
            <button type="button" role="menuitem" onClick={() => { onAbout(); setProfileOpen(false); }}>Acerca del proyecto</button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); onExit(); }}>Cerrar sesión (demo)</button>
            <p>Esta acción cierra la vista local. No hay cuentas ni protección de acceso.</p>
          </div>}
        </div>
      </div>
    </header>
  );
}

function Loading() {
  return <div className="loading"><span /><p>Procesando el conjunto de datos…</p></div>;
}

function ErrorState({ message, retry }) {
  return <div className="error-state"><strong>No pudimos cargar el análisis</strong><p>{message}</p><button onClick={retry}>Reintentar</button></div>;
}

function Kpi({ label, value, detail, tone = "red", icon }) {
  return (
    <article className={`kpi ${tone}`}>
      <div className="kpi-icon"><Icon name={icon} size={21} /></div>
      <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    </article>
  );
}

function Bars({ data, valueKey, formatter = number.format, color = "red" }) {
  const max = Math.max(...data.map((item) => item[valueKey]), 1);
  return (
    <div className="bars">
      {data.map((item) => (
        <div className="bar-row" key={item.name}>
          <span>{item.name}</span>
          <div className="bar-track"><i className={color} style={{ width: `${Math.max(5, item[valueKey] / max * 100)}%` }} /></div>
          <strong>{formatter(item[valueKey])}</strong>
        </div>
      ))}
    </div>
  );
}

function ComparisonBars({ pairs, actualKey, proposedKey, formatter, unit }) {
  const max = Math.max(1, ...pairs.map((pair) => pair[actualKey]));
  return <div className="comparison-bars" role="img" aria-label={`Comparación de ${unit} antes y después por zona`}>
    <div className="comparison-legend"><span><i className="comparison-dot before"/>Antes: ocho rutas municipales</span><span><i className="comparison-dot after"/>Después: cuatro zonas</span></div>
    {pairs.map((pair) => <div className="comparison-item" key={pair.zone}>
      <div className="comparison-name"><strong>{pair.zone}</strong><span>{pair.municipalities}</span></div>
      <div className="comparison-lines">
        <div className="comparison-line"><span>Antes</span><div className="comparison-track"><i className="before" style={{width: `${pair[actualKey] / max * 100}%`}}/></div><strong>{formatter(pair[actualKey])}</strong></div>
        <div className="comparison-line"><span>Después</span><div className="comparison-track"><i className="after" style={{width: `${pair[proposedKey] / max * 100}%`}}/></div><strong>{formatter(pair[proposedKey])}</strong></div>
      </div>
    </div>)}
  </div>;
}

function Dashboard({ data, period, metadata }) {
  const { summary, municipalities, drivers } = data;
  const label = period === "all"
    ? `${metadata.date_min.slice(0, 10)} al ${metadata.date_max.slice(0, 10)}`
    : new Intl.DateTimeFormat("es-HN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div><span className="eyebrow">SITUACIÓN ACTUAL · OPERACIÓN BASE</span><h1>Así opera <em>Atlántida Express.</em></h1><p>Datos informativos de la operación original, sin aplicar ninguna propuesta de optimización. Periodo seleccionado: {label}.</p></div>
        <div className="live-badge"><span />Datos actualizados</div>
      </section>
      <section className="kpi-grid">
        <Kpi label="Pedidos gestionados" value={number.format(summary.orders)} detail={`${summary.delayed} entregas retrasadas`} icon="overview" />
        <Kpi label="Ingresos registrados" value={money.format(summary.revenue)} detail={`${summary.drivers} repartidores activos`} icon="operation" />
        <Kpi label="Combustible estimado" value={money.format(summary.fuel_cost)} detail={`${number.format(summary.distance_km)} km recorridos, incluido regreso`} tone="amber" icon="operation" />
        <Kpi label="Entregas a tiempo" value={`${summary.on_time_rate}%`} detail={`${summary.delivered} pedidos entregados`} tone="green" icon="quality" />
      </section>
      <section className="panel">
        <div className="panel-heading"><div><span>RECORRIDO DE LA OPERACIÓN ORIGINAL</span><h2>Kilómetros por municipio</h2><p>Distancia base estimada para atender los pedidos del período, incluido el regreso a La Ceiba.</p></div><strong>{number.format(summary.distance_km)} km</strong></div>
        <Bars data={municipalities} valueKey="distance_km" formatter={(value) => `${number.format(value)} km`} />
      </section>
      <section className="dashboard-grid">
        <article className="panel wide">
          <div className="panel-heading"><div><span>DEMANDA TERRITORIAL</span><h2>Pedidos por municipio</h2></div><strong>{summary.orders} pedidos</strong></div>
          <Bars data={municipalities} valueKey="orders" />
        </article>
        <article className="panel efficiency-card">
          <div className="panel-heading"><div><span>NIVEL DE SERVICIO</span><h2>Cumplimiento</h2></div></div>
          <div className="donut" style={{ "--value": `${summary.on_time_rate * 3.6}deg` }}><div><strong>{summary.on_time_rate}%</strong><span>a tiempo</span></div></div>
          <div className="legend"><span><i className="green-dot" />Entregados <b>{summary.delivered}</b></span><span><i className="red-dot" />Retrasados <b>{summary.delayed}</b></span></div>
        </article>
        <article className="panel wide">
          <div className="panel-heading"><div><span>RENDIMIENTO HUMANO</span><h2>Carga por repartidor</h2></div><button onClick={() => window.location.hash = "operation"}>Ver detalle</button></div>
          <Bars data={drivers} valueKey="orders" color="orange" />
        </article>
        <article className="panel insight">
          <span>LECTURA DEL PERIODO</span><h2>{summary.orders} pedidos analizados.</h2><p>{metadata.periods.length} periodos disponibles en el archivo. La tasa de cumplimiento se calcula con los horarios límite documentados en el Excel.</p><div className="insight-footer"><Icon name="quality" /><span>Fuente: {metadata.dataset}</span></div>
        </article>
      </section>
    </div>
  );
}

function Operation({ data }) {
  return (
    <div className="page-stack">
      <section className="page-heading"><div><span className="eyebrow">ANÁLISIS OPERATIVO · ESCENARIO BASE</span><h1>Territorio y equipo, <em>sin cifras aisladas.</em></h1><p>Demanda, ingresos, combustible y carga de los ocho repartidores antes de la propuesta. La comparación con cuatro zonas aparece en Optimización.</p></div></section>
      <section className="panel">
        <div className="panel-heading"><div><span>RENTABILIDAD TERRITORIAL</span><h2>Ingresos por municipio</h2></div></div>
        <Bars data={data.municipalities} valueKey="revenue" formatter={money.format} color="green" />
      </section>
      <section className="table-panel">
        <div className="panel-heading"><div><span>EQUIPO DE ENTREGA</span><h2>Rendimiento por repartidor</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>Repartidor base</th><th>Pedidos</th><th>Ingresos</th><th>Combustible base</th><th>Distancia base</th><th>Tiempo promedio</th></tr></thead><tbody>
          {data.drivers.map((driver) => <tr key={driver.name}><td><div className="person-cell"><span>{driver.name.split(" ").map((x) => x[0]).join("")}</span><strong>{driver.name}</strong></div></td><td>{driver.orders}</td><td>{money.format(driver.revenue)}</td><td>{money.format(driver.fuel_cost)}</td><td>{number.format(driver.distance_km)} km</td><td>{number.format(driver.average_time)} min</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

function Quality({ quality }) {
  const issues = quality.checks.filter((check) => check.status !== "ok").length;
  return (
    <div className="page-stack">
      <section className="page-heading"><div><span className="eyebrow">CONTROL DE CALIDAD</span><h1>Antes de optimizar, <em>hay que confiar en los datos.</em></h1><p>Validaciones automáticas de estructura, unicidad y coherencia matemática.</p></div></section>
      <section className="quality-hero panel">
        <div className="score-ring" style={{ "--score": `${quality.score * 3.6}deg` }}><div><strong>{quality.score}</strong><span>/ 100</span></div></div>
        <div><span className="eyebrow">COMPROBACIONES AUTOMÁTICAS</span><h2>{issues ? "Hay diferencias que revisar." : "Las comprobaciones implementadas no detectan diferencias."}</h2><p>Esta puntuación resume {quality.checks.length} reglas de control; no certifica la exactitud vial ni sustituye mediciones verificadas.</p></div>
        <div className="quality-stats"><span><strong>{number.format(quality.rows_analyzed)}</strong>filas revisadas</span><span><strong>{quality.duplicate_orders}</strong>pedidos duplicados</span><span><strong>{quality.invalid_dates}</strong>fechas inválidas</span></div>
      </section>
      <section className="checks-grid">
        {quality.checks.map((check) => <article className="check-card" key={check.name}><span className={check.status}>{check.status === "ok" ? "✓" : "!"}</span><div><strong>{check.name}</strong><small>{check.detail}</small></div></article>)}
      </section>
      <section className="panel warning-panel"><div className="warning-icon">{issues ? "!" : "✓"}</div><div><span>{issues ? "REVISIÓN PENDIENTE" : "ALCANCE DE LA VALIDACIÓN"}</span><h2>{issues ? `${quality.route_differences.cost} diferencias de costo en rutas` : "Cálculos internos conciliados"}</h2><p>{issues ? `La mayor diferencia observada es ${money.format(quality.route_differences.max_cost_difference)}.` : "El traslado por carretera y el retorno son estimaciones; faltan GPS, tráfico y validación de campo."}</p></div></section>
    </div>
  );
}

function Optimization({ scenario, metadata }) {
  const dateLabel = (date) => new Intl.DateTimeFormat("es-HN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
  const periodLabel = `Del ${dateLabel(scenario.date_min || metadata.date_min)} al ${dateLabel(scenario.date_max || metadata.date_max)}`;
  const reduction = (before, saving) => before ? `${number.format(saving / before * 100)}%` : "—";
  return <div className="page-stack">
    <section className="page-heading"><div><span className="eyebrow">ESCENARIO DE CUATRO ZONAS</span><h1>Ocho repartidores, <em>cuatro rutas compartidas.</em></h1><p>Se conservan los mismos pedidos y fechas. La propuesta reúne municipios cercanos bajo un repartidor y compara sus kilómetros y combustible con la operación base. {periodLabel}.</p></div></section>
    <section className="kpi-grid">
      <Kpi label="Repartidores" value={`${scenario.base_drivers} → ${scenario.proposed_drivers}`} detail={`${scenario.base_routes} rutas base · ${scenario.routes} rutas propuestas`} icon="overview" />
      <Kpi label="Distancia base" value={`${number.format(scenario.actual_km)} km`} detail="Ocho zonas independientes" icon="operation" />
      <Kpi label="Distancia propuesta" value={`${number.format(scenario.proposed_km)} km`} detail={`${number.format(scenario.saving_km)} km menos`} icon="optimize" />
      <Kpi label="Ahorro de combustible del periodo" value={money.format(scenario.saving_cost)} detail={periodLabel} tone="green" icon="quality" />
    </section>
    <section className="comparison-grid">
      <article className="panel"><div className="panel-heading"><div><span>ANTES Y DESPUÉS</span><h2>Kilómetros por zona</h2></div></div><ComparisonBars pairs={scenario.pairs} actualKey="actual_km" proposedKey="proposed_km" formatter={(value) => `${number.format(value)} km`} unit="kilómetros" /></article>
      <article className="panel"><div className="panel-heading"><div><span>ANTES Y DESPUÉS</span><h2>Combustible por zona</h2></div></div><ComparisonBars pairs={scenario.pairs} actualKey="actual_cost" proposedKey="proposed_cost" formatter={money.format} unit="combustible" /></article>
    </section>
    <section className="table-panel">
      <div className="panel-heading"><div><span>COMPARACIÓN POR ZONA</span><h2>Distancia y combustible</h2></div></div>
      <div className="table-scroll"><table><thead><tr><th>Municipios</th><th>Repartidor</th><th>Pedidos</th><th>Km base</th><th>Km propuesta</th><th>Ahorro km</th><th>Combustible base</th><th>Combustible propuesta</th><th>Ahorro</th></tr></thead><tbody>
        {scenario.pairs.map((pair) => <tr key={pair.zone}><td><strong>{pair.municipalities}</strong></td><td>{pair.driver}</td><td>{pair.orders}</td><td>{number.format(pair.actual_km)}</td><td>{number.format(pair.proposed_km)}</td><td>{number.format(pair.saving_km)}</td><td>{money.format(pair.actual_cost)}</td><td>{money.format(pair.proposed_cost)}</td><td>{money.format(pair.saving_cost)}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="panel honest-note"><Icon name="quality" size={30}/><div><strong>Ahorro salarial solo como supuesto: {money.format(scenario.salary_saving_monthly_assumed)} por mes.</strong><p>Usa L 18,000 mensuales por persona y requiere reducir cuatro puestos; si se reasignan, no hay ahorro salarial. {scenario.days_over_capacity} rutas superan la capacidad y {scenario.days_over_shift} superan ocho horas según el modelo. Los horarios límite de la propuesta aún no están validados.</p></div></section>
    <section className="panel honest-note"><Icon name="operation" size={30}/><div><strong>Estimación académica, no ahorro comprobado.</strong><p>La ruta entre municipios se aproxima con distancias desde La Ceiba; el reparto local no utiliza GPS. El combustible se valora al precio de septiembre de 2026, aunque los pedidos corresponden a mayo–junio.</p></div></section>
    <section className="table-panel savings-panel">
      <div className="panel-heading"><div><span>BALANCE DEL ESCENARIO</span><h2>¿Cuánto cambia la operación?</h2><p>{periodLabel}. Cada diferencia se calcula como antes menos después.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Concepto</th><th>Antes</th><th>Después</th><th>Ahorro</th><th>Reducción</th></tr></thead><tbody>
        <tr><td><strong>Kilómetros recorridos</strong></td><td>{number.format(scenario.actual_km)} km</td><td>{number.format(scenario.proposed_km)} km</td><td className="saving-value">{number.format(scenario.saving_km)} km</td><td>{reduction(scenario.actual_km, scenario.saving_km)}</td></tr>
        <tr><td><strong>Rutas realizadas</strong></td><td>{number.format(scenario.base_routes)}</td><td>{number.format(scenario.routes)}</td><td className="saving-value">{number.format(scenario.base_routes - scenario.routes)}</td><td>{reduction(scenario.base_routes, scenario.base_routes - scenario.routes)}</td></tr>
        <tr><td><strong>Combustible</strong></td><td>{moneyExact.format(scenario.actual_cost)}</td><td>{moneyExact.format(scenario.proposed_cost)}</td><td className="saving-value">{moneyExact.format(scenario.saving_cost)}</td><td>{reduction(scenario.actual_cost, scenario.saving_cost)}</td></tr>
        <tr><td><strong>Salarios (supuesto)</strong></td><td>{moneyExact.format(scenario.base_salary_period_assumed)}</td><td>{moneyExact.format(scenario.proposed_salary_period_assumed)}</td><td className="saving-value">{moneyExact.format(scenario.salary_saving_period_assumed)}</td><td>{reduction(scenario.base_salary_period_assumed, scenario.salary_saving_period_assumed)}</td></tr>
      </tbody><tfoot><tr><th>Total estimado: combustible + salarios</th><td>{moneyExact.format(scenario.total_cost_base_assumed)}</td><td>{moneyExact.format(scenario.total_cost_proposed_assumed)}</td><td className="saving-value">{moneyExact.format(scenario.total_saving_assumed)}</td><td>{reduction(scenario.total_cost_base_assumed, scenario.total_saving_assumed)}</td></tr></tfoot></table></div>
      <p className="savings-note">Salarios prorrateados por días calendario del período con {money.format(scenario.salary_monthly_per_driver_assumed)} mensuales por repartidor. El ahorro salarial y el total son condicionales: requieren reducir cuatro puestos; si se reasignan, el ahorro de salarios es L 0 y solo permanece el ahorro estimado de combustible. No se incluyen prestaciones, mantenimiento ni otros gastos.</p>
    </section>
  </div>;
}

function About({ metadata }) {
  return <div className="page-stack"><section className="page-heading"><div><span className="eyebrow">CIENCIA DE DATOS II</span><h1>Del notebook a un <em>sistema funcional.</em></h1><p>Atlántida Analytics transforma el análisis exploratorio existente en una aplicación con frontend, backend y validaciones.</p></div></section><section className="about-grid"><article className="panel"><span>OBJETIVO</span><h2>Apoyar decisiones logísticas con evidencia.</h2><p>Centraliza indicadores, compara periodos y expone problemas de calidad antes de producir recomendaciones.</p></article><article className="panel"><span>ARQUITECTURA</span><h2>React + FastAPI + Pandas</h2><p>El frontend consulta una API que procesa el Excel. No existen indicadores financieros escritos manualmente en la interfaz.</p></article><article className="panel data-card"><span>FUENTE ACTIVA</span><h2>{metadata.dataset}</h2><p>{metadata.sheets.length} hojas · {metadata.date_min.slice(0,10)} al {metadata.date_max.slice(0,10)}</p></article></section></div>;
}

export default function App() {
  const hashView = window.location.hash.replace("#", "");
  const [view, setViewState] = useState(["overview", "operation", "quality", "optimize", "simulator", "about"].includes(hashView) ? hashView : "overview");
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 900);
  const [period, setPeriod] = useState("all");
  const [theme, setTheme] = useState(localStorage.getItem("atlantida-theme") || "light");
  const [zoom, setZoom] = useState(() => {
    const saved = Number(localStorage.getItem("atlantida-zoom"));
    return Number.isFinite(saved) && saved >= 90 && saved <= 130 ? saved : 110;
  });
  const [demoOpen, setDemoOpen] = useState(true);
  const [metadata, setMetadata] = useState(null);
  const [data, setData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const setView = (next) => { setViewState(next); window.location.hash = next; };
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("atlantida-theme", theme); }, [theme]);
  useEffect(() => {
    document.documentElement.style.zoom = `${zoom}%`;
    localStorage.setItem("atlantida-zoom", String(zoom));
  }, [zoom]);
  useEffect(() => {
    const handleHashChange = () => {
      const next = window.location.hash.replace("#", "");
      if (["overview", "operation", "quality", "optimize", "simulator", "about"].includes(next)) {
        setViewState(next);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const load = () => {
    setLoading(true); setError("");
    Promise.all([getMetadata(), getDashboard(period), getQuality(), getRouteScenario(period)])
      .then(([meta, dashboard, qualityData, routeData]) => { setMetadata(meta); setData(dashboard); setQuality(qualityData); setScenario(routeData); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [period]);

  const content = useMemo(() => {
    if (!data || !quality || !metadata || !scenario) return null;
    if (view === "simulator") return <Simulator />;
    if (view === "operation") return <Operation data={data} />;
    if (view === "quality") return <Quality quality={quality} />;
    if (view === "optimize") return <Optimization scenario={scenario} metadata={metadata} />;
    if (view === "about") return <About metadata={metadata} />;
    return <Dashboard data={data} period={period} metadata={metadata} />;
  }, [view, data, quality, metadata, scenario, period]);

  if (!demoOpen) return <div className="demo-closed"><div className="brand-mark">A</div><h1>Demostración cerrada</h1><p>Se cerró la vista de este navegador. Este proyecto todavía no tiene cuentas ni autenticación; volver a abrirlo no requiere contraseña.</p><button type="button" onClick={() => { setDemoOpen(true); setView("overview"); }}>Volver al dashboard</button></div>;
  return <div className="app-shell"><Sidebar view={view} setView={setView} open={sidebarOpen} setOpen={setSidebarOpen}/><main className={sidebarOpen ? "content" : "content full"}><Header period={period} setPeriod={setPeriod} periods={metadata?.periods || []} theme={theme} setTheme={setTheme} zoom={zoom} setZoom={setZoom} onAbout={() => setView("about")} onExit={() => setDemoOpen(false)} showPeriod={["overview","operation","optimize"].includes(view)} />{loading ? <Loading /> : error ? <ErrorState message={error} retry={load} /> : content}<footer>Atlántida Analytics · Proyecto académico de Ciencia de Datos II <span>Fuente: archivo Excel del proyecto</span></footer></main></div>;
}
