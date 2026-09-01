# -*- coding: utf-8 -*-
"""
Three-line table formatter for DOCX.

Converts tables to academic three-line format:
- Top border: 1.5pt solid
- Header bottom: 0.75pt solid
- Bottom border: 1.5pt solid
- No vertical lines, no inner horizontal lines
"""

from docx.oxml.ns import qn
from docx.oxml import OxmlElement


def make_three_line_table(table):
    """
    Convert a single table to three-line format.

    Args:
        table: python-docx Table object

    Returns:
        dict with conversion result
    """
    tbl = table._tbl
    tblPr = tbl.tblPr

    # 1. Remove all existing table-level borders
    for old_b in tblPr.findall(qn('w:tblBorders')):
        tblPr.remove(old_b)

    # 2. Set table-level borders: top+bottom thick, rest none
    borders = OxmlElement('w:tblBorders')
    for edge_name, sz, val in [
        ('top', '12', 'single'),       # 1.5pt
        ('left', '0', 'none'),
        ('bottom', '12', 'single'),    # 1.5pt
        ('right', '0', 'none'),
        ('insideH', '0', 'none'),
        ('insideV', '0', 'none'),
    ]:
        el = OxmlElement(f'w:{edge_name}')
        el.set(qn('w:val'), val)
        el.set(qn('w:sz'), sz)
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), '000000')
        borders.append(el)
    tblPr.append(borders)

    # 3. Clear all cell-level borders (let table-level borders take effect)
    for row in table.rows:
        for cell in row.cells:
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
            for old in tcPr.findall(qn('w:tcBorders')):
                tcPr.remove(old)

    # 4. Header row: add bottom thin line (0.75pt)
    header_bold_count = 0
    if len(table.rows) > 0:
        header_row = table.rows[0]
        for cell in header_row.cells:
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
            tcBorders = OxmlElement('w:tcBorders')

            bottom = OxmlElement('w:bottom')
            bottom.set(qn('w:val'), 'single')
            bottom.set(qn('w:sz'), '6')  # 0.75pt
            bottom.set(qn('w:space'), '0')
            bottom.set(qn('w:color'), '000000')
            tcBorders.append(bottom)

            tcPr.append(tcBorders)

            # Bold header text
            for para in cell.paragraphs:
                for run in para.runs:
                    if not run.bold:
                        run.bold = True
                        header_bold_count += 1

    return {
        'rows': len(table.rows),
        'cols': len(table.columns),
        'header_bold_runs': header_bold_count,
    }


def convert_all_tables_to_three_line(doc):
    """
    Convert all tables in a document to three-line format.

    Args:
        doc: python-docx Document object

    Returns:
        list of conversion results
    """
    results = []
    for i, table in enumerate(doc.tables):
        r = make_three_line_table(table)
        r['index'] = i
        results.append(r)
    return results
