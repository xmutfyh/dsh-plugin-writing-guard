# -*- coding: utf-8 -*-
"""
Scope Integrity Checker.

Verifies that editing operations did not modify content outside
the requested scope. Uses semantic comparison of paragraph text
before and after editing.
"""

from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class IntegrityCheckResult:
    """Result of a scope integrity check."""
    scope_intact: bool = True
    requested_scope: str = ""
    unchanged_regions: list = field(default_factory=list)
    unexpected_changes: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


def _get_para_texts(doc):
    """Extract all paragraph texts from a document."""
    return [p.text for p in doc.paragraphs]


def check_scope_integrity(doc_before, doc_after, scope, scope_description=""):
    """
    Verify that only the intended scope was modified.

    Compares paragraph texts before and after editing and reports
    any unexpected changes outside the requested scope.

    Args:
        doc_before: python-docx Document (before editing)
        doc_after: python-docx Document (after editing)
        scope: EditScope with paragraph range
        scope_description: human-readable description of the scope

    Returns:
        IntegrityCheckResult
    """
    result = IntegrityCheckResult(requested_scope=scope_description)

    texts_before = _get_para_texts(doc_before)
    texts_after = _get_para_texts(doc_after)

    # Ensure same paragraph count
    if len(texts_before) != len(texts_after):
        result.warnings.append(
            f"Paragraph count changed: {len(texts_before)} → {len(texts_after)}"
        )
        # Still check what we can

    scope_indices = set(scope.included_paragraphs)
    total_paras = min(len(texts_before), len(texts_after))

    # Check paragraphs outside scope
    for i in range(total_paras):
        if i not in scope_indices:
            if texts_before[i] != texts_after[i]:
                result.unexpected_changes.append({
                    'paragraph_index': i,
                    'before': texts_before[i][:100],
                    'after': texts_after[i][:100],
                })

    # Check paragraphs inside scope (expected changes)
    scope_changed = 0
    scope_unchanged = 0
    for i in range(total_paras):
        if i in scope_indices:
            if texts_before[i] != texts_after[i]:
                scope_changed += 1
            else:
                scope_unchanged += 1

    # Build unchanged regions summary
    if not result.unexpected_changes:
        result.scope_intact = True
        result.unchanged_regions.append("All out-of-scope content is unchanged")
    else:
        result.scope_intact = False
        result.warnings.append(
            f"{len(result.unexpected_changes)} unexpected changes found "
            f"outside the requested scope"
        )

    result.unchanged_regions.append(
        f"Scope: {scope_changed} paragraphs modified, "
        f"{scope_unchanged} paragraphs unchanged within scope"
    )

    return result


def compare_paragraphs(before_paras, after_paras, indices):
    """
    Compare specific paragraphs between two document states.

    Args:
        before_paras: paragraphs from before document
        after_paras: paragraphs from after document
        indices: list of paragraph indices to compare

    Returns:
        list of dicts with comparison results
    """
    results = []
    for i in indices:
        if i < len(before_paras) and i < len(after_paras):
            before_text = before_paras[i].text
            after_text = after_paras[i].text
            results.append({
                'index': i,
                'changed': before_text != after_text,
                'before': before_text[:200],
                'after': after_text[:200],
            })
    return results
