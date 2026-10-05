# -*- coding: utf-8 -*-
"""Default academic equation layout for DOCX/OMML equations.

For numbered display equations the equation body is centered and the trailing
number (for example ``(7)`` or ``(4-14a)``) is placed at the right text margin
on the same line. Unnumbered display equations are centered.

The implementation only adjusts paragraph/tab layout. It does not rebuild,
rewrite, or convert the OMML equation itself.
"""
from __future__ import annotations

import re

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


_NUM_RE = re.compile(r"\(\s*\d+(?:[-–—]\d+)?[A-Za-z]?\s*\)\s*$")
_MATH_TAGS = {qn('m:oMath'), qn('m:oMathPara')}
_EMU_PER_TWIP = 635


def _contains_math(element) -> bool:
    if element.tag in _MATH_TAGS:
        return True
    return (
        element.find('.//' + qn('m:oMath')) is not None
        or element.find('.//' + qn('m:oMathPara')) is not None
    )


def _child_visible_text(element) -> str:
    """Return regular Word text from one direct paragraph child."""
    return ''.join((node.text or '') for node in element.iter(qn('w:t')))


def _is_tab_only_run(element) -> bool:
    if element.tag != qn('w:r'):
        return False
    meaningful = []
    has_tab = False
    for child in element:
        if child.tag == qn('w:rPr'):
            continue
        meaningful.append(child)
        if child.tag == qn('w:tab'):
            has_tab = True
    return bool(meaningful) and has_tab and all(child.tag == qn('w:tab') for child in meaningful)


def _remove_direct_tab_runs(paragraph):
    """Remove alignment tabs previously used by an equation paragraph."""
    p = paragraph._p
    for child in list(p):
        if _is_tab_only_run(child):
            p.remove(child)


def _tab_run():
    run = OxmlElement('w:r')
    run.append(OxmlElement('w:tab'))
    return run


def _set_exact_tab_stops(paragraph, center_twips: int, right_twips: int):
    pPr = paragraph._p.get_or_add_pPr()
    for old in list(pPr.findall(qn('w:tabs'))):
        pPr.remove(old)

    tabs = OxmlElement('w:tabs')
    center = OxmlElement('w:tab')
    center.set(qn('w:val'), 'center')
    center.set(qn('w:pos'), str(center_twips))
    tabs.append(center)

    right = OxmlElement('w:tab')
    right.set(qn('w:val'), 'right')
    right.set(qn('w:pos'), str(right_twips))
    tabs.append(right)
    pPr.append(tabs)


def _usable_width_twips(section) -> int:
    available_emu = int(section.page_width) - int(section.left_margin) - int(section.right_margin)
    return max(1, round(available_emu / _EMU_PER_TWIP))


def _section_indices_for_paragraphs(doc):
    """Map each top-level paragraph to its Word section index."""
    out = []
    section_idx = 0
    max_idx = max(0, len(doc.sections) - 1)
    for paragraph in doc.paragraphs:
        out.append(min(section_idx, max_idx))
        pPr = paragraph._p.pPr
        if pPr is not None and pPr.find(qn('w:sectPr')) is not None:
            section_idx = min(section_idx + 1, max_idx)
    return out


def _find_math_span(paragraph):
    children = list(paragraph._p)
    indices = [i for i, child in enumerate(children) if _contains_math(child)]
    if not indices:
        return None
    return min(indices), max(indices)


def _find_number_child_index(paragraph, after_index: int):
    """Find the direct child at which the trailing equation number begins."""
    children = list(paragraph._p)
    parts = []
    combined = ''
    for i in range(after_index + 1, len(children)):
        text = _child_visible_text(children[i])
        if not text:
            continue
        start = len(combined)
        combined += text
        parts.append((i, start, len(combined)))

    match = _NUM_RE.search(combined)
    if not match:
        return None, None

    match_start = match.start()
    for child_index, start, end in parts:
        if end > match_start:
            return child_index, match.group(0).strip()
    return None, match.group(0).strip()


def format_equation_paragraph(paragraph, section) -> dict:
    """Apply the default layout to one paragraph containing an OMML equation."""
    if not _contains_math(paragraph._p):
        return {'action': 'skipped', 'reason': 'no_omml'}

    # Rebuild only the paragraph's alignment tabs, never the OMML equation.
    _remove_direct_tab_runs(paragraph)
    span = _find_math_span(paragraph)
    if span is None:
        return {'action': 'skipped', 'reason': 'no_direct_math_span'}
    first_math, last_math = span

    number_index, number_text = _find_number_child_index(paragraph, last_math)
    if number_index is None:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        return {
            'action': 'centered_unnumbered',
            'number': None,
            'layout': 'centered',
        }

    width = _usable_width_twips(section)
    center_pos = width // 2
    right_pos = width
    _set_exact_tab_stops(paragraph, center_pos, right_pos)

    # A tab stop based layout requires left paragraph alignment. The first tab
    # centers the equation; the second tab puts its number at the right margin.
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT

    # Recalculate after pPr/tab cleanup; indexes refer only to paragraph body
    # children and pPr stays first, so use the math elements themselves.
    p = paragraph._p
    children = list(p)
    math_indices = [i for i, child in enumerate(children) if _contains_math(child)]
    if not math_indices:
        return {'action': 'skipped', 'reason': 'math_disappeared'}
    first_math = min(math_indices)
    last_math = max(math_indices)
    number_index, number_text = _find_number_child_index(paragraph, last_math)
    if number_index is None:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        return {'action': 'centered_unnumbered', 'number': None, 'layout': 'centered'}

    children = list(p)
    first_math_el = children[first_math]
    number_el = children[number_index]
    p.insert(p.index(first_math_el), _tab_run())
    # number_el remains the same XML object after the first insertion.
    p.insert(p.index(number_el), _tab_run())

    return {
        'action': 'formatted_numbered',
        'number': number_text,
        'layout': 'equation_center_number_right_same_line',
        'center_tab_twips': center_pos,
        'right_tab_twips': right_pos,
    }


def format_equations(doc) -> list[dict]:
    """Apply the default academic layout to all top-level OMML equations."""
    section_map = _section_indices_for_paragraphs(doc)
    results = []
    for idx, paragraph in enumerate(doc.paragraphs):
        if not _contains_math(paragraph._p):
            continue
        section = doc.sections[section_map[idx]]
        item = {'paragraph_index': idx}
        item.update(format_equation_paragraph(paragraph, section))
        results.append(item)
    return results
