# -*- coding: utf-8 -*-
"""Native Word equation (OMML) audit and baseline comparison."""

from copy import deepcopy
from docx.oxml.ns import qn


def _attr(el, name, default=None):
    return el.get(qn(name), default) if el is not None else default


def _style_id(para):
    try:
        return para.style.style_id if para.style else None
    except Exception:
        return None


def _tabs(para):
    ppr = para._p.find(qn("w:pPr"))
    if ppr is None:
        return []
    tabs = ppr.find(qn("w:tabs"))
    if tabs is None:
        return []
    return [
        {
            "val": _attr(t, "w:val"),
            "pos": _attr(t, "w:pos"),
        }
        for t in tabs.findall(qn("w:tab"))
    ]


def _math_font(doc):
    settings = doc.settings._element
    math_pr = settings.find(qn("m:mathPr"))
    if math_pr is None:
        return None
    math_font = math_pr.find(qn("m:mathFont"))
    if math_font is None:
        return None
    return _attr(math_font, "m:val")


def audit_equations(doc, baseline_doc=None):
    """
    Audit native OMML equations and compare their layout to a baseline document.

    This is intentionally read-only. It reports format drift rather than
    silently normalising mathematical typography.
    """
    equations = []
    eq_no = 0
    baseline_math_font = _math_font(baseline_doc) if baseline_doc else None
    math_font = _math_font(doc)

    baseline_eq_paras = []
    if baseline_doc:
        baseline_eq_paras = [
            p for p in baseline_doc.paragraphs
            if p._p.find(".//" + qn("m:oMath")) is not None
        ]

    for p_idx, para in enumerate(doc.paragraphs):
        maths = para._p.findall(".//" + qn("m:oMath"))
        if not maths:
            continue
        for _ in maths:
            eq_no += 1
            entry = {
                "equation_index": eq_no,
                "paragraph_index": p_idx,
                "native_omml": True,
                "style_id": _style_id(para),
                "tabs": _tabs(para),
                "math_font": math_font,
                "text_preview": para.text[:120],
                "warnings": [],
            }
            if baseline_doc:
                if math_font != baseline_math_font:
                    entry["warnings"].append(
                        f"math font differs from baseline: {math_font!r} vs {baseline_math_font!r}"
                    )
                if eq_no <= len(baseline_eq_paras):
                    bp = baseline_eq_paras[eq_no - 1]
                    if _style_id(para) != _style_id(bp):
                        entry["warnings"].append(
                            f"equation paragraph style differs from baseline: "
                            f"{_style_id(para)!r} vs {_style_id(bp)!r}"
                        )
                    if _tabs(para) != _tabs(bp):
                        entry["warnings"].append("equation tab stops differ from baseline")
            equations.append(entry)

    return {
        "equation_count": len(equations),
        "math_font": math_font,
        "baseline_math_font": baseline_math_font,
        "equations": equations,
        "warnings": [
            w for e in equations for w in e["warnings"]
        ],
    }
