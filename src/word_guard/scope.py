# -*- coding: utf-8 -*-
"""
Scope Resolver.

Locates edit targets in a DOCX document using structural anchors
(headings, section numbers) rather than page numbers or paragraph indices.
"""

import re
from dataclasses import dataclass, field
from typing import Optional, List
from difflib import SequenceMatcher


@dataclass
class EditScope:
    """Resolved edit scope with paragraph range and protection info."""
    start_para_index: int
    end_para_index: int
    start_heading: Optional[str] = None
    end_heading: Optional[str] = None
    start_heading_level: Optional[int] = None
    end_heading_level: Optional[int] = None
    included_paragraphs: list = field(default_factory=list)  # list[int]
    included_tables: list = field(default_factory=list)  # list[int]
    protected_neighbors: list = field(default_factory=list)  # list[str]
    ambiguous: bool = False
    ambiguity_options: list = field(default_factory=list)  # list[str]
    warnings: list = field(default_factory=list)


def _normalize_heading(text):
    """Normalize heading text for matching."""
    return re.sub(r'\s+', ' ', text.strip().lower())


def _fuzzy_match(query, candidate, threshold=0.6):
    """Check if candidate matches query with fuzzy matching."""
    q = _normalize_heading(query)
    c = _normalize_heading(candidate)

    # Exact match
    if q == c:
        return 1.0

    # Substring match
    if q in c or c in q:
        return 0.9

    # SequenceMatcher for fuzzy
    ratio = SequenceMatcher(None, q, c).ratio()
    return ratio


def _is_heading(para):
    """Check if a paragraph is a heading (supports both WordParagraphInfo and raw Paragraph)."""
    if hasattr(para, 'is_heading'):
        return para.is_heading
    # Raw python-docx Paragraph: check style name
    if hasattr(para, 'style') and para.style:
        style_name = para.style.name or ''
        if style_name.startswith('Heading'):
            return True
    return False


def _get_heading_level(para):
    """Get heading level (supports both WordParagraphInfo and raw Paragraph)."""
    if hasattr(para, 'heading_level'):
        return para.heading_level
    # Raw python-docx Paragraph
    if hasattr(para, 'style') and para.style:
        import re
        m = re.search(r'heading\s*(\d+)', para.style.name or '', re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None


def _get_para_text(para):
    """Get paragraph text (supports both WordParagraphInfo and raw Paragraph)."""
    if hasattr(para, 'text'):
        return para.text
    return ''


def _get_para_index(para, fallback_index):
    """Get paragraph index (supports both WordParagraphInfo and raw Paragraph)."""
    if hasattr(para, 'index'):
        return para.index
    return fallback_index


def _find_heading(paragraphs, heading_text, level=None, allow_fuzzy=True):
    """
    Find a heading paragraph matching the given text.

    Args:
        paragraphs: list of WordParagraphInfo or raw Paragraph objects
        heading_text: heading text to match
        level: optional heading level to filter by
        allow_fuzzy: whether to use fuzzy matching

    Returns:
        list of (index, match_score, paragraph_info) tuples
    """
    matches = []
    for i, p in enumerate(paragraphs):
        if not _is_heading(p):
            continue
        p_level = _get_heading_level(p)
        if level is not None and p_level is not None and p_level != level:
            continue

        text = _get_para_text(p)
        score = _fuzzy_match(heading_text, text)
        if score >= 0.5:
            idx = _get_para_index(p, i)
            matches.append((idx, score, p))

    # Sort by score descending
    matches.sort(key=lambda x: -x[1])
    return matches


def resolve_scope(paragraphs, start_heading=None, end_heading=None,
                  heading=None, level=None, start_index=None, end_index=None,
                  allow_fuzzy=True):
    """
    Resolve an edit scope from heading anchors or paragraph indices.

    Supports multiple resolution modes:
    1. Section by heading: start_heading → end_heading
    2. Single section: heading (uses parent/child boundaries)
    3. Direct index range: start_index → end_index

    Args:
        paragraphs: list of WordParagraphInfo from scanner
        start_heading: start heading text (inclusive)
        end_heading: end heading text (exclusive)
        heading: single heading to select (for edit_section mode)
        level: heading level filter
        start_index: direct start paragraph index
        end_index: direct end paragraph index
        allow_fuzzy: whether to use fuzzy heading matching

    Returns:
        EditScope with resolved paragraph range
    """
    scope = EditScope(start_para_index=0, end_para_index=len(paragraphs) - 1)

    # ── Mode 1: Explicit index range ──
    if start_index is not None and end_index is not None:
        scope.start_para_index = max(0, start_index)
        scope.end_para_index = min(len(paragraphs) - 1, end_index)
        scope.included_paragraphs = list(
            range(scope.start_para_index, scope.end_para_index + 1)
        )
        return scope

    # ── Mode 2: Section range (start_heading → end_heading) ──
    if start_heading and end_heading:
        start_matches = _find_heading(paragraphs, start_heading, level, allow_fuzzy)
        end_matches = _find_heading(paragraphs, end_heading, level, allow_fuzzy)

        if not start_matches:
            scope.warnings.append(f"Start heading not found: '{start_heading}'")
            scope.ambiguous = True
            return scope
        if not end_matches:
            scope.warnings.append(f"End heading not found: '{end_heading}'")
            scope.ambiguous = True
            return scope

        if len(start_matches) > 1 and start_matches[0][1] < 0.9:
            scope.ambiguous = True
            scope.ambiguity_options = [_get_para_text(m[2]) for m in start_matches[:5]]
            scope.warnings.append(
                f"Multiple matches for start heading '{start_heading}': "
                f"{[_get_para_text(m[2]) for m in start_matches[:3]]}"
            )
            return scope

        start_idx = start_matches[0][0]
        end_idx = end_matches[0][0]

        scope.start_para_index = start_idx
        scope.end_para_index = end_idx - 1  # exclusive
        scope.start_heading = _get_para_text(start_matches[0][2])
        scope.end_heading = _get_para_text(end_matches[0][2])
        scope.start_heading_level = _get_heading_level(start_matches[0][2])
        scope.end_heading_level = _get_heading_level(end_matches[0][2])
        scope.included_paragraphs = list(range(start_idx, end_idx))

        return scope

    # ── Mode 3: Single heading (section edit) ──
    if heading:
        matches = _find_heading(paragraphs, heading, level, allow_fuzzy)

        if not matches:
            scope.warnings.append(f"Heading not found: '{heading}'")
            scope.ambiguous = True
            return scope

        if len(matches) > 1 and matches[0][1] < 0.9:
            scope.ambiguous = True
            scope.ambiguity_options = [_get_para_text(m[2]) for m in matches[:5]]
            scope.warnings.append(
                f"Multiple matches for heading '{heading}': "
                f"{[_get_para_text(m[2]) for m in matches[:3]]}"
            )
            return scope

        target = matches[0]
        target_idx = target[0]
        target_level = _get_heading_level(target[2]) or 1

        # Find the end: next heading at same or higher level
        end_idx = len(paragraphs)
        for j, p in enumerate(paragraphs[target_idx + 1:]):
            if _is_heading(p) and _get_heading_level(p) is not None and _get_heading_level(p) <= target_level:
                end_idx = _get_para_index(p, target_idx + 1 + j)
                break

        scope.start_para_index = target_idx
        scope.end_para_index = end_idx - 1
        scope.start_heading = _get_para_text(target[2])
        scope.start_heading_level = target_level
        scope.included_paragraphs = list(range(target_idx, end_idx))

        return scope

    # ── Default: full document ──
    scope.included_paragraphs = list(range(len(paragraphs)))
    return scope


def find_paragraph_containing(paragraphs, substring, case_sensitive=False):
    """
    Find all paragraphs whose text contains the given substring.

    Args:
        paragraphs: list of WordParagraphInfo (or doc.paragraphs)
        substring: text to search for
        case_sensitive: whether the search is case-sensitive

    Returns:
        list of (index, paragraph) tuples
    """
    results = []
    for i, p in enumerate(paragraphs):
        text = p.text if hasattr(p, 'text') else str(p)
        if case_sensitive:
            if substring in text:
                results.append((i, p))
        else:
            if substring.lower() in text.lower():
                results.append((i, p))
    return results
