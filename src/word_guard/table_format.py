# -*- coding: utf-8 -*-
"""Baseline-aware three-line table formatter for scholarly DOCX documents.

Safety principles:
1. Classify tables before formatting.  Layout/figure-container tables are never
   converted automatically.
2. Prefer the baseline manuscript's border weights when available.
3. Put top/header/bottom rules on row cells rather than table-level bottom
   borders, avoiding false bottom rules at page breaks in long tables.
4. Do not silently bold headers or otherwise restyle text.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement


@dataclass
class ThreeLineSpec:
    top_sz: str = '12'       # eighths of a point -> 1.5 pt
    header_sz: str = '6'     # 0.75 pt
    bottom_sz: str = '12'    # 1.5 pt
    color: str = '000000'
    source: str = 'plugin_default'

    def to_dict(self):
        return asdict(self)


def _has_drawing(table) -> bool:
    return table._tbl.find('.//' + qn('w:drawing')) is not None or table._tbl.find('.//' + qn('w:pict')) is not None


def _table_text(table) -> str:
    return '\n'.join(cell.text for row in table.rows for cell in row.cells).strip()


def classify_table(table, preceding_text: str = '') -> dict:
    """Classify a Word table conservatively as data/layout/unknown."""
    text = _table_text(table)
    rows, cols = len(table.rows), len(table.columns)
    prefix = (preceding_text or '').strip().lower()

    if _has_drawing(table):
        return {'kind': 'layout', 'confidence': 'high', 'reason': 'contains drawing/picture'}
    if prefix.startswith('table ') or prefix.startswith('table\t') or prefix.startswith('表'):
        return {'kind': 'data', 'confidence': 'high', 'reason': 'preceded by table caption'}
    # Typical layout containers are tiny and mostly empty.
    nonempty = sum(1 for row in table.rows for cell in row.cells if cell.text.strip())
    total = max(1, rows * cols)
    if rows <= 2 and cols <= 3 and (not text or nonempty / total < 0.5):
        return {'kind': 'layout', 'confidence': 'medium', 'reason': 'small sparse layout-like table'}
    # Conservative data heuristic: at least 2x2 and substantive textual/numeric content.
    if rows >= 2 and cols >= 2 and len(text) >= 20:
        return {'kind': 'data', 'confidence': 'medium', 'reason': 'multi-row/column content table'}
    return {'kind': 'unknown', 'confidence': 'low', 'reason': 'insufficient evidence for safe auto-formatting'}


def _preceding_paragraph_text(table):
    el = table._tbl.getprevious()
    while el is not None:
        if el.tag == qn('w:p'):
            texts = el.findall('.//' + qn('w:t'))
            return ''.join(t.text or '' for t in texts)
        el = el.getprevious()
    return ''


def _edge_sz(container, edge):
    if container is None:
        return None
    el = container.find(qn(f'w:{edge}'))
    if el is None or el.get(qn('w:val')) in (None, 'none', 'nil'):
        return None
    return el.get(qn('w:sz'))


def infer_spec_from_table(table) -> ThreeLineSpec | None:
    """Infer a three-line border specification from an existing baseline table."""
    if not table.rows:
        return None
    tblBorders = table._tbl.tblPr.find(qn('w:tblBorders'))
    top = _edge_sz(tblBorders, 'top')
    bottom = _edge_sz(tblBorders, 'bottom')

    # Prefer row-cell borders; this also recognizes the safer split-table form.
    first = table.rows[0].cells[0]._tc.get_or_add_tcPr().find(qn('w:tcBorders'))
    last = table.rows[-1].cells[0]._tc.get_or_add_tcPr().find(qn('w:tcBorders'))
    top = _edge_sz(first, 'top') or top
    header = _edge_sz(first, 'bottom')
    bottom = _edge_sz(last, 'bottom') or bottom

    if top and header and bottom:
        return ThreeLineSpec(top, header, bottom, '000000', 'baseline')
    return None


def infer_spec_from_baseline(baseline_path: str, table_index: int | None = None) -> ThreeLineSpec | None:
    doc = Document(baseline_path)
    if table_index is not None and 0 <= table_index < len(doc.tables):
        spec = infer_spec_from_table(doc.tables[table_index])
        if spec:
            return spec
    # Fall back to the first confidently data-like table with a recognizable spec.
    for t in doc.tables:
        c = classify_table(t, _preceding_paragraph_text(t))
        if c['kind'] == 'data':
            spec = infer_spec_from_table(t)
            if spec:
                return spec
    return None


def _set_cell_border(cell, edge: str, sz: str, color='000000', val='single'):
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = tcPr.find(qn('w:tcBorders'))
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    old = tcBorders.find(qn(f'w:{edge}'))
    if old is not None:
        tcBorders.remove(old)
    el = OxmlElement(f'w:{edge}')
    el.set(qn('w:val'), val)
    el.set(qn('w:sz'), sz)
    el.set(qn('w:space'), '0')
    el.set(qn('w:color'), color)
    tcBorders.append(el)


def _clear_cell_borders(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    for old in tcPr.findall(qn('w:tcBorders')):
        tcPr.remove(old)


def make_three_line_table(table, spec: ThreeLineSpec | None = None):
    spec = spec or ThreeLineSpec()
    if not table.rows:
        return {'rows': 0, 'cols': 0, 'spec': spec.to_dict()}

    # Remove table-level rules entirely. Cell-level rules survive pagination more reliably.
    tblPr = table._tbl.tblPr
    for old_b in tblPr.findall(qn('w:tblBorders')):
        tblPr.remove(old_b)
    borders = OxmlElement('w:tblBorders')
    for edge_name in ('top','left','bottom','right','insideH','insideV'):
        el = OxmlElement(f'w:{edge_name}')
        el.set(qn('w:val'), 'none')
        el.set(qn('w:sz'), '0')
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), spec.color)
        borders.append(el)
    tblPr.append(borders)

    # Clear existing cell borders first, then define exactly three horizontal rules.
    for row in table.rows:
        for cell in row.cells:
            _clear_cell_borders(cell)

    for cell in table.rows[0].cells:
        _set_cell_border(cell, 'top', spec.top_sz, spec.color)
        _set_cell_border(cell, 'bottom', spec.header_sz, spec.color)
    for cell in table.rows[-1].cells:
        _set_cell_border(cell, 'bottom', spec.bottom_sz, spec.color)

    return {
        'rows': len(table.rows),
        'cols': len(table.columns),
        'spec': spec.to_dict(),
    }


def convert_tables_to_three_line(doc, baseline_path: str | None = None, include_unknown: bool = False):
    """Format only tables classified as data tables; skip layout tables by default."""
    results = []
    for i, table in enumerate(doc.tables):
        preceding = _preceding_paragraph_text(table)
        cls = classify_table(table, preceding)
        item = {'index': i, 'classification': cls, 'action': 'skipped'}
        if cls['kind'] == 'data' or (include_unknown and cls['kind'] == 'unknown'):
            spec = infer_spec_from_baseline(baseline_path, i) if baseline_path else None
            formatted = make_three_line_table(table, spec or ThreeLineSpec())
            item.update(formatted)
            item['action'] = 'formatted'
        results.append(item)
    return results


# Backward-compatible alias. Safety behavior is intentionally changed: layout/unknown tables are skipped.
def convert_all_tables_to_three_line(doc):
    return convert_tables_to_three_line(doc)
