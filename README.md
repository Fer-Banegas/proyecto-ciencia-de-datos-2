# Atlántida Analytics

Sistema académico para convertir el análisis logístico de Ciencia de Datos I en una aplicación funcional de Ciencia de Datos II.

## Funciones del sistema

- Backend REST con FastAPI y documentación automática.
- Lectura del archivo de trabajo `Distribuidor Atlántida Express 2.xlsx` mediante Pandas.
- Dashboard filtrable por mayo, junio o todo el periodo.
- Análisis por municipio y repartidor.
- Validación automática de calidad y consistencia.
- Comparación de ocho rutas municipales independientes frente a cuatro zonas compartidas, con kilómetros, combustible, jornada y capacidad.
- Frontend React responsivo con tema claro y oscuro.
- Manejo de estados de carga y errores.
- Simulador para importar el Excel original o preparado, editar equipo, municipios, vehículos y combustible, recalcular escenarios y descargar un PDF comparativo.

## Ejecución

Clona este repositorio y abre su carpeta:

```bash
git clone https://github.com/Fer-Banegas/proyecto-ciencia-de-datos-2.git
cd proyecto-ciencia-de-datos-2
```

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --reload-dir app
```

La API estará en `http://127.0.0.1:8000` y su documentación en `http://127.0.0.1:8000/docs`.

### Frontend

En otra terminal:

```bash
cd frontend
npm install
npm run dev
```

La aplicación estará en `http://127.0.0.1:5173`.

## Datos y límites del caso

Los dos archivos Excel del proyecto se encuentran en `data/`. El archivo original `Distribuidora_Atlantida_Express.xlsx` se conserva sin cambios. La copia preparada que utiliza la aplicación es `Distribuidor Atlántida Express 2.xlsx`. No hace falta moverlos ni configurar rutas absolutas.

La copia conserva los 230 identificadores y valores comerciales. La hoja `Parametros_Operacion` contiene los kilómetros de carretera de referencia desde La Ceiba, el precio del diésel de referencia desde el 14 de septiembre de 2026, el salario mensual asumido para el análisis y la asignación de cuatro pares de municipios. La Ceiba tiene 0 km de traslado intermunicipal, pero sí recorrido local. `Rutas_Base` conserva la operación de ocho repartidores; `Rutas_Diarias` calcula las rutas compartidas de cada fecha; `Rutas_Comparacion` resume cuatro zonas sin duplicar kilómetros ni costos. Cada ruta suma ida, reparto local y regreso. Los recorridos locales se estiman con coordenadas de clientes (Haversine × 1,25), no con trazas GPS. La conexión entre municipios del mismo corredor se aproxima por la diferencia de sus distancias desde La Ceiba. El costo de combustible de mayo-junio se valora con el precio de referencia de septiembre; no corresponde a un gasto histórico verificado. San Francisco conserva una distancia de planificación pendiente de validación vial. El ahorro salarial supone L 18,000 mensuales por persona y solo existe si se reducen cuatro puestos; si se reasignan, no se materializa. La capacidad y jornada se comprueban, pero las ventanas de entrega del escenario propuesto no están validadas. Todos los ahorros son potenciales.

La hoja `Resumen` presenta antes/después/ahorro en personal, rutas, kilómetros, combustible y tiempo. `Pedidos` y `Rutas_Base` están identificados explícitamente como **escenario base**; `Rutas_Diarias` muestra ambos recorridos y explica cuándo una jornada tiene distancia equivalente. `Rutas_Comparacion`, `Vehiculos` y `Repartidores` concilian los totales de las cuatro zonas. No se asigna artificialmente una distancia propuesta a cada pedido individual: una ruta compartida no admite ese reparto único sin una regla adicional. La web presenta barras comparativas por zona en Resumen y Optimización.

La API expone `/api/route-scenario` para consultar el escenario por periodo y `/api/quality` para revisar los controles internos. La hoja `Contexto_Proyecto` del Excel documenta los supuestos.

## Simulador de escenarios

En la pestaña **Simulador**, el caso preparado se carga inicialmente como ejemplo. «Cargar otro Excel» acepta la estructura original de `Distribuidora_Atlantida_Express.xlsx` o el libro preparado `Distribuidor Atlántida Express 2.xlsx`. El original no incorpora distancias y vehículos consistentes; en ese caso, el sistema **reconstruye la base** con pedidos, coordenadas de clientes y distancias/vehículos de referencia del proyecto. El reporte lo indica: no presenta las columnas defectuosas como gastos históricos reales. Un archivo ajeno o vacío se rechaza sin sustituir el archivo activo.

Agrega o excluye repartidores del *escenario* (nunca del Excel), distribuye todos los municipios entre zonas y elige un repartidor y vehículo distintos para cada zona. Puedes editar el precio del diésel. «Calcular escenario» compara la misma fuente base con la propuesta, muestra ahorros positivos o aumentos negativos, y advierte si una ruta supera capacidad o 8 horas. «Descargar reporte PDF» vuelve a calcular la propuesta actual y entrega las cifras, zonas, porcentajes, advertencias y supuestos. No existe optimizador vial GPS ni validación de ventanas de entrega. Las sesiones importadas se guardan solo en memoria del servidor y se pierden al reiniciarlo; no hay cuentas de usuario ni persistencia de escenarios.

## Pruebas

```bash
cd backend
source .venv/bin/activate
pytest
```

Para auditar las relaciones entre hojas y conciliaciones del Excel, ejecuta desde la carpeta del proyecto `python scripts/audit_excel.py "data/Distribuidor Atlántida Express 2.xlsx"` con el entorno Python del backend activo.
