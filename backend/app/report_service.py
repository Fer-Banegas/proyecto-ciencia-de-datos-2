"""Reporte PDF de un escenario ya validado y recalculado."""

from datetime import date
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak


def _comparison_chart(title: str, values: list[tuple[str, float]], unit: str) -> Drawing:
    width, height = 17.2 * cm, 2.45 * cm
    chart = Drawing(width, height)
    chart.add(String(0, height - 11, title, fontName="Helvetica-Bold", fontSize=9, fillColor=colors.HexColor("#283746")))
    colors_by_scenario = ("#a51420", "#657d89", "#168257")
    max_value = max(1, *(value for _, value in values))
    bar_x, bar_width = 2.3 * cm, 10.5 * cm
    for index, (label, value) in enumerate(values):
        y = height - 30 - index * 15
        chart.add(String(0, y + 2, label, fontName="Helvetica", fontSize=7.5, fillColor=colors.HexColor("#283746")))
        chart.add(Rect(bar_x, y, bar_width, 8, fillColor=colors.HexColor("#f0edeb"), strokeColor=None))
        chart.add(Rect(bar_x, y, max(1, bar_width * value / max_value), 8,
                       fillColor=colors.HexColor(colors_by_scenario[index]), strokeColor=None))
        chart.add(String(bar_x + bar_width + 8, y + 1, f"{value:,.2f} {unit}", fontName="Helvetica-Bold", fontSize=7.5,
                         fillColor=colors.HexColor("#283746")))
    return chart


def _zone_chart(zones: list[dict]) -> Drawing:
    width, row_height = 17.2 * cm, 1.25 * cm
    chart = Drawing(width, max(1, len(zones)) * row_height + 12)
    largest = max(1, *(zone["before_km"] for zone in zones), *(zone["after_km"] for zone in zones))
    bar_x, bar_width = 2.4 * cm, 10.2 * cm
    for index, zone in enumerate(zones):
        top = chart.height - index * row_height - 17
        chart.add(String(0, top - 4, zone["id"], fontName="Helvetica-Bold", fontSize=9, fillColor=colors.HexColor("#283746")))
        for offset, label, value, color in ((0, "Antes", zone["before_km"], "#a51420"),
                                            (13, "Después", zone["after_km"], "#168257")):
            y = top - offset
            chart.add(String(0.7 * cm, y - 1, label, fontName="Helvetica", fontSize=7.5, fillColor=colors.HexColor("#5e6268")))
            chart.add(Rect(bar_x, y, bar_width, 8, fillColor=colors.HexColor("#f0edeb"), strokeColor=None))
            chart.add(Rect(bar_x, y, max(1, bar_width * value / largest), 8, fillColor=colors.HexColor(color), strokeColor=None))
            chart.add(String(bar_x + bar_width + 8, y + 1, f"{value:,.2f} km", fontName="Helvetica-Bold", fontSize=7.5,
                             fillColor=colors.HexColor("#283746")))
    return chart


def build_report(result: dict) -> bytes:
    stream = BytesIO()
    doc = SimpleDocTemplate(stream, pagesize=(21 * cm, 29.7 * cm), rightMargin=1.7 * cm,
                            leftMargin=1.7 * cm, topMargin=1.6 * cm, bottomMargin=1.5 * cm)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold",
                              textColor=colors.HexColor("#921823"), fontSize=19, leading=23, spaceAfter=12))
    styles.add(ParagraphStyle(name="ReportSmall", parent=styles["Normal"], fontSize=8, leading=11,
                              textColor=colors.HexColor("#5e6268")))
    styles.add(ParagraphStyle(name="ReportCell", parent=styles["Normal"], fontSize=8, leading=10))
    styles.add(ParagraphStyle(name="ReportHead", parent=styles["ReportCell"], fontName="Helvetica-Bold", textColor=colors.white))
    P = lambda value, kind="ReportCell": Paragraph(escape(str(value)), styles[kind])
    def period_date(value: str) -> str:
        parsed = date.fromisoformat(value)
        return f"{parsed.day:02d}/{parsed.month:02d}/{parsed.year}"

    story = [Paragraph(f"Atlántida Express | Escenario logístico<br/><font size='11'>Período evaluado: {period_date(result['start_date'])} al {period_date(result['end_date'])}</font>", styles["ReportTitle"]),
             Paragraph(f"Archivo fuente: {escape(result['filename'])} | {result['orders']} pedidos | Formato: {result['format']}", styles["ReportSmall"]),
             Spacer(1, 14), Paragraph("Comparación general", styles["Heading2"])]

    def num(value, unit=""):
        return f"{value:,.2f}{unit}"

    data = [[P(x, "ReportHead") for x in ("Indicador", "Antes", "Después", "Ahorro / aumento", "Variación")]]
    for name, key, prefix in (("Recorrido (km)", "kilometers", ""), ("Costo combustible (L)", "fuel_cost", "L "),
                              ("Rutas del período", "routes", ""), ("Repartidores usados", "drivers", ""), ("Vehículos en ruta", "vehicles", "")):
        metric = result[key]
        delta = metric["saving"]
        decimals = 0 if key in {"routes", "drivers", "vehicles"} else 2
        show = lambda value: f"{value:,.{decimals}f}"
        change_label = ("Ahorro " if delta >= 0 else "Aumento ") if key == "fuel_cost" else ("Menos " if delta >= 0 else "Más ")
        data.append([P(name), P(prefix + show(metric["before"])), P(prefix + show(metric["after"])),
                     P(change_label + prefix + show(abs(delta))),
                     P(f"{abs(metric['percent']):.1f}% {'menos' if delta >= 0 else 'más'}")])
    table = Table(data, colWidths=[4.1*cm, 2.7*cm, 2.7*cm, 4.0*cm, 3.8*cm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0,0),(-1,0),colors.HexColor("#283746")),
                               ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white, colors.HexColor("#f7f5f4")]),
                               ("BOTTOMPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),8),
                               ("LINEBELOW",(0,-1),(-1,-1),0.6,colors.HexColor("#d9d4d1"))]))
    fleet = result["fleet_status"]
    story += [table, Spacer(1, 12), Paragraph(f"Flota del escenario: {len(fleet['in_route'])} en ruta, {len(fleet['reserve'])} de reserva ({escape(', '.join(fleet['reserve']) or 'ninguno')}) y {len(fleet['inactive'])} fuera del escenario ({escape(', '.join(fleet['inactive']) or 'ninguno')}).", styles["ReportSmall"]),
              Paragraph("Tener vehículos de reserva o fuera de ruta no genera por sí solo ahorro monetario. El costo de combustible usa el rendimiento del vehículo asignado; no se estiman mantenimiento, seguros, depreciación ni peajes.", styles["ReportSmall"]),
              Spacer(1, 12)]
    reference = result.get("reference")
    if reference:
        three_way = [[P(x, "ReportHead") for x in ("Indicador", "Base", "Sistema · 4 zonas", "Tu simulación")]]
        for name, key, unit in (("Recorrido", "kilometers", " km"), ("Rutas", "routes", ""),
                                ("Repartidores", "drivers", ""), ("Vehículos en ruta", "vehicles", ""),
                                ("Combustible", "fuel_cost", " L"), ("Salarios (supuesto)", "salary", " L"),
                                ("Combustible + salarios*", "total_cost", " L")):
            decimals = 0 if key in {"routes", "drivers", "vehicles"} else 2
            format_value = lambda value: f"{value:,.{decimals}f}{unit}"
            three_way.append([P(name), P(format_value(result[key]["before"])),
                              P(format_value(reference[key]["after"])), P(format_value(result[key]["after"]))])
        three_way_table = Table(three_way, colWidths=[4.4*cm, 3.9*cm, 4.5*cm, 4.4*cm], repeatRows=1)
        three_way_table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#283746")),
                                             ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#f7f5f4")]),
                                             ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),5),
                                             ("BOTTOMPADDING",(0,0),(-1,-1),5),
                                             ("LINEBELOW",(0,-1),(-1,-1),0.8,colors.HexColor("#168257"))]))
        story += [Paragraph("Tres escenarios · mismo período y fuente", styles["Heading2"]), three_way_table,
                  Spacer(1, 5), Paragraph("*El ahorro salarial solo se materializa si se reducen puestos. Si los repartidores se reasignan, el ahorro salarial es cero; el total estimado debe interpretarse con esa condición.", styles["ReportSmall"]),
                  Spacer(1, 8), Paragraph("Comparación visual", styles["Heading2"]),
                  KeepTogether([_comparison_chart("Kilómetros recorridos", [("Base", result["kilometers"]["before"]), ("Sistema", reference["kilometers"]["after"]), ("Simulación", result["kilometers"]["after"])], "km")]),
                  KeepTogether([_comparison_chart("Costo de combustible", [("Base", result["fuel_cost"]["before"]), ("Sistema", reference["fuel_cost"]["after"]), ("Simulación", result["fuel_cost"]["after"])], "L")])]
    story += [PageBreak(), Paragraph("Asignación propuesta por zona", styles["Heading2"])]
    rows = [[P(x, "ReportHead") for x in ("Zona y municipios", "Repartidor / vehículo", "N.º pedidos", "Km antes", "Km después", "Costo después")]]
    for zone in result["zones"]:
        rows.append([P(f"{zone['id']}: {', '.join(zone['municipalities'])}"), P(f"{zone['driver']} / {zone['vehicle_id']}"),
                     P(zone["orders"]), P(num(zone["before_km"])), P(num(zone["after_km"])), P("L " + num(zone["after_cost"]))])
    zones_table = Table(rows, colWidths=[4.1*cm, 3.8*cm, 1.6*cm, 2.4*cm, 2.4*cm, 3.0*cm], repeatRows=1)
    zones_table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#283746")),
                                     ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("GRID",(0,0),(-1,-1),0.35,colors.HexColor("#ddd8d5")),
                                     ("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7)]))
    story += [zones_table, Spacer(1, 14), Paragraph("Distancia por zona: antes y después", styles["Heading2"]),
              _zone_chart(result["zones"]), Spacer(1, 12), Paragraph("Método y límites", styles["Heading2"]),
              Paragraph(escape(result["method"]), styles["ReportSmall"]), Spacer(1, 5),
              Paragraph(f"Precio fuente: L {result['fuel_price_source']:.4f}/L. Precio del escenario: L {result['fuel_price_scenario']:.4f}/L.", styles["ReportSmall"])]
    for note in result["notes"]:
        story.append(Paragraph("- " + escape(note), styles["ReportSmall"]))
    if result["warnings"]:
        story += [Spacer(1, 10), Paragraph("Advertencias operativas", styles["Heading2"])]
        for warning in result["warnings"]:
            story.append(Paragraph("- " + escape(warning), styles["ReportSmall"]))
    story += [Spacer(1, 12), Paragraph("Estimación del modelo. No demuestra optimalidad global, tiempos reales de tránsito ni cumplimiento de ventanas de entrega.", styles["ReportSmall"])]
    doc.build(story)
    return stream.getvalue()
