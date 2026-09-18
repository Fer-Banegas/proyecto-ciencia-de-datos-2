from io import BytesIO
from urllib.parse import unquote

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .data_service import data_service
from .errors import DatasetError
from .scenario_service import get_source, import_source, simulate, MAX_BYTES
from .report_service import build_report


app = FastAPI(
    title="Atlántida Analytics API",
    description="API académica para analizar la operación logística de Atlántida Express.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(DatasetError)
async def dataset_error_handler(_: Request, exc: DatasetError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"message": exc.message, "code": exc.code},
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, __: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "message": "Ocurrió un error inesperado al procesar la información.",
            "code": "INTERNAL_ERROR",
        },
    )


@app.get("/health", tags=["Sistema"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "atlantida-analytics"}


@app.get("/api/metadata", tags=["Datos"])
def metadata():
    return data_service.metadata()


@app.get("/api/summary", tags=["Análisis"])
def summary(period: str = Query("all")):
    return data_service.summary(period)


@app.get("/api/municipalities", tags=["Análisis"])
def municipalities(period: str = Query("all")):
    return data_service.municipalities(period)


@app.get("/api/drivers", tags=["Análisis"])
def drivers(period: str = Query("all")):
    return data_service.drivers(period)


@app.get("/api/quality", tags=["Calidad"])
def quality():
    return data_service.quality()


@app.get("/api/route-scenario", tags=["Análisis"])
def route_scenario(period: str = Query("all")):
    return data_service.route_scenario(period)


@app.get("/api/simulator/source", tags=["Simulador"])
def simulator_source():
    return get_source("default").public("default")


@app.post("/api/simulator/import", tags=["Simulador"])
async def simulator_import(request: Request):
    if int(request.headers.get("content-length", "0")) > MAX_BYTES:
        raise DatasetError("El Excel supera 15 MB.", "INVALID_UPLOAD")
    body = await request.body()
    filename = unquote(request.headers.get("X-Filename", "archivo.xlsx"))
    return import_source(body, filename)


@app.post("/api/simulator/calculate", tags=["Simulador"])
def simulator_calculate(payload: dict):
    return simulate(get_source(str(payload.get("source_id", "default"))), payload)


@app.post("/api/simulator/report", tags=["Simulador"])
def simulator_report(payload: dict):
    result = simulate(get_source(str(payload.get("source_id", "default"))), payload)
    output = build_report(result)
    return StreamingResponse(BytesIO(output), media_type="application/pdf", headers={
        "Content-Disposition": 'attachment; filename="atlantida-comparacion.pdf"',
        "Cache-Control": "no-store",
    })
