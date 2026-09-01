# -*- coding: utf-8 -*-
"""Native OMML equation audit with optional baseline comparison."""
from __future__ import annotations

from docx import Document
from docx.oxml.ns import qn
from lxml import etree
import zipfile


def _math_font(path):
    try:
        with zipfile.ZipFile(path) as zf:
            root = etree.fromstring(zf.read('word/settings.xml'))
            mathPr = root.find('.//' + qn('m:mathPr'))
            if mathPr is not None:
                mf = mathPr.find(qn('m:mathFont'))
                if mf is not None:
                    return mf.get(qn('m:val'))
    except Exception:
        return None
    return None


def _tab_stops(p):
    pPr = p._element.find(qn('w:pPr'))
    if pPr is None:
        return []
    tabs = pPr.find(qn('w:tabs'))
    if tabs is None:
        return []
    out = []
    for tab in tabs.findall(qn('w:tab')):
        out.append({'val': tab.get(qn('w:val')), 'pos': tab.get(qn('w:pos'))})
    return out


def _number_text(p):
    # Equation numbering is often plain text in the same paragraph, e.g. (3).
    import re
    m = re.search(r'\(\s*\d+[A-Za-z]?\s*\)\s*$', p.text or '')
    return m.group(0).strip() if m else None


def audit_equations(path: str, baseline_path: str | None = None) -> dict:
    doc = Document(path)
    baseline_font = _math_font(baseline_path) if baseline_path else None
    current_font = _math_font(path)
    equations = []
    numbers = []
    for idx, p in enumerate(doc.paragraphs):
        has_omath = p._element.find('.//' + qn('m:oMath')) is not None
        has_para = p._element.find('.//' + qn('m:oMathPara')) is not None
        if not (has_omath or has_para):
            continue
        n = _number_text(p)
        if n:
            import re
            numbers.append(int(re.search(r'\d+', n).group()))
        equations.append({
            'paragraph_index': idx,
            'native_omml': True,
            'oMathPara': has_para,
            'style': p.style.style_id if p.style else None,
            'tabs': _tab_stops(p),
            'number': n,
            'text_preview': p.text[:120],
        })

    continuity = True
    if numbers:
        continuity = numbers == list(range(numbers[0], numbers[0] + len(numbers)))

    issues = []
    if baseline_path and baseline_font and current_font != baseline_font:
        issues.append(f"Math font differs from baseline: {current_font!r} vs {baseline_font!r}")
    if numbers and not continuity:
        issues.append(f"Equation numbering is not continuous: {numbers}")

    return {
        'file': path,
        'equation_count': len(equations),
        'math_font': current_font,
        'baseline_math_font': baseline_font,
        'math_font_matches_baseline': None if not baseline_path else current_font == baseline_font,
        'numbered_equations': len(numbers),
        'number_sequence': numbers,
        'numbering_continuous': continuity,
        'equations': equations,
        'issues': issues,
    }
