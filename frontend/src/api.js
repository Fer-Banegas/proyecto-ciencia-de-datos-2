const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function request(path) {
  const response = await fetch(`${API_URL}${path}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "No se pudo consultar el servidor.");
  }
  return payload;
}

export function getDashboard(period = "all") {
  const query = `?period=${encodeURIComponent(period)}`;
  return Promise.all([
    request(`/api/summary${query}`),
    request(`/api/municipalities${query}`),
    request(`/api/drivers${query}`),
  ]).then(([summary, municipalities, drivers]) => ({ summary, municipalities, drivers }));
}

export function getMetadata() {
  return request("/api/metadata");
}

export function getQuality() {
  return request("/api/quality");
}

export function getRouteScenario(period = "all") {
  return request(`/api/route-scenario?period=${encodeURIComponent(period)}`);
}

async function send(path, body, headers = {}) {
  const response = await fetch(`${API_URL}${path}`, { method: "POST", headers, body });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "No se pudo procesar el escenario.");
  }
  return response;
}

export function getSimulatorSource() { return request("/api/simulator/source"); }
export async function importSimulatorFile(file) {
  const response = await send("/api/simulator/import", file, { "X-Filename": encodeURIComponent(file.name) });
  return response.json();
}
export async function calculateSimulator(payload) {
  const response = await send("/api/simulator/calculate", JSON.stringify(payload), { "Content-Type": "application/json" });
  return response.json();
}
export async function downloadSimulatorReport(payload) {
  const response = await send("/api/simulator/report", JSON.stringify(payload), { "Content-Type": "application/json" });
  return response.blob();
}
