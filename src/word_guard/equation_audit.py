# -*- coding: utf-8 -*-
"""Native OMML equation audit with optional baseline comparison.

编号体系支持两种（v2.0.2 起）：
  * 连续式：``(1) (2) (3) …``
  * 章节式：``(4-1) (4-2) … (5-1) …``（中文学位/竞赛论文常用），
    并允许同一序号配不同字母后缀，如 ``(4-14a) (4-14b)``。

连续性判定：连续式要求序号等差分递增；章节式要求**每一章内部序号连续**、
章号按出现顺序递增、同一序号重复时后缀必须不同。
"""
from __future__ import annotations

import re

from docx import Document
from docx.oxml.ns import qn
from lxml import etree
import zipfile

# 行尾编号：(4-1) (4-14a) (12) (12a)；横线兼容 - – —
_NUM_RE = re.compile(r"\(\s*(\d+(?:[-–—]\d+)?[A-Za-z]?)\s*\)\s*$")
_CHAP_RE = re.compile(r"^(\d+)[-–—](\d+)([A-Za-z]?)$")
_FLAT_RE = re.compile(r"^(\d+)([A-Za-z]?)$")


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
    """取段落末尾的公式编号，返回编号本体字符串（不含括号）。"""
    m = _NUM_RE.search(p.text or '')
    return m.group(1) if m else None


def _number_key(n):
    """编号 → (章号, 序号, 后缀)；连续式章号为 None。无法解析返回 None。"""
    m = _CHAP_RE.match(n)
    if m:
        return (int(m.group(1)), int(m.group(2)), m.group(3))
    m = _FLAT_RE.match(n)
    if m:
        return (None, int(m.group(1)), m.group(2))
    return None


def _numbering_style(raw):
    keys = [_number_key(n) for n in raw]
    if not keys or any(k is None for k in keys):
        return "unknown"
    chap = [k for k in keys if k[0] is not None]
    if not chap:
        return "flat"
    if len(chap) == len(keys):
        return "chapter"
    return "mixed"


def _check_continuity(raw):
    """按编号体系判定连续性。"""
    keys = [_number_key(n) for n in raw]
    if not keys or any(k is None for k in keys):
        return False
    has_chap = [k for k in keys if k[0] is not None]
    if has_chap and len(has_chap) != len(keys):
        return False                                   # 两种体系混用
    if not has_chap:                                   # ---- 连续式
        idx = [k[1] for k in keys]
        return idx == list(range(idx[0], idx[0] + len(idx)))
    # ---- 章节式
    groups = []
    for chap, idx, suf in keys:
        if groups and groups[-1][0] == chap:
            groups[-1][1].append((idx, suf))
        else:
            groups.append((chap, [(idx, suf)]))
    if len({g[0] for g in groups}) != len(groups):
        return False                                   # 同一章被拆成多段
    prev = None
    for chap, items in groups:
        if prev is not None and chap <= prev:
            return False                               # 章号必须递增
        prev = chap
        seen = {}
        for idx, suf in items:
            if idx in seen and seen[idx] == suf:
                return False                           # 同号同后缀 = 重复
            seen[idx] = suf
        uniq = sorted(seen)
        if uniq != list(range(uniq[0], uniq[0] + len(uniq))):
            return False                               # 章内序号必须连续
    return True


def _number_groups(raw):
    """把编号按章分组，便于报告。"""
    out = {}
    for n in raw:
        k = _number_key(n)
        if k is None:
            out.setdefault("?", []).append(n)
            continue
        key = "连续编号" if k[0] is None else "%d 章" % k[0]
        out.setdefault(key, []).append(n)
    return out


def audit_equations(path: str, baseline_path: str | None = None) -> dict:
    doc = Document(path)
    baseline_font = _math_font(baseline_path) if baseline_path else None
    current_font = _math_font(path)
    equations = []
    raw_numbers = []
    for idx, p in enumerate(doc.paragraphs):
        has_omath = p._element.find('.//' + qn('m:oMath')) is not None
        has_para = p._element.find('.//' + qn('m:oMathPara')) is not None
        if not (has_omath or has_para):
            continue
        n = _number_text(p)
        if n:
            raw_numbers.append(n)
        equations.append({
            'paragraph_index': idx,
            'native_omml': True,
            'oMathPara': has_para,
            'style': p.style.style_id if p.style else None,
            'tabs': _tab_stops(p),
            'number': n,
            'text_preview': p.text[:120],
        })

    style = _numbering_style(raw_numbers)
    continuity = _check_continuity(raw_numbers) if raw_numbers else True

    issues = []
    if baseline_path and baseline_font and current_font != baseline_font:
        issues.append(f"Math font differs from baseline: {current_font!r} vs {baseline_font!r}")
    if raw_numbers and style == "mixed":
        issues.append("Equation numbering mixes flat and chapter styles: %s" % raw_numbers)
    if raw_numbers and style == "unknown":
        issues.append("Unrecognised equation number format: %s" % raw_numbers)
    if raw_numbers and not continuity:
        issues.append("Equation numbering is not continuous: %s" % raw_numbers)

    return {
        'file': path,
        'equation_count': len(equations),
        'math_font': current_font,
        'baseline_math_font': baseline_font,
        'math_font_matches_baseline': None if not baseline_path else current_font == baseline_font,
        'numbered_equations': len(raw_numbers),
        'number_sequence': raw_numbers,
        'numbering_style': style,
        'numbering_groups': _number_groups(raw_numbers),
        'numbering_continuous': continuity,
        'equations': equations,
        'issues': issues,
    }
