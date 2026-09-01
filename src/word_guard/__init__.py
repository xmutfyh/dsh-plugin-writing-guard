# -*- coding: utf-8 -*-
"""
Word Manuscript Guard - Safe scholarly DOCX mutation module.

Provides structural scanning, scope resolution, run-aware editing,
protected node policy, change manifest, and scope integrity checking
for scholarly Word documents.
"""

from .scanner import scan_docx, WordParagraphInfo, WordDocumentInfo
from .scope import resolve_scope, EditScope
from .editor import (
    replace_text_in_paragraph,
    replace_section_text,
    insert_paragraph_after,
    replace_entire_paragraph,
)
from .protected import PROTECTED_TAGS, is_protected_node, check_complex_paragraph
from .manifest import ChangeManifest
from .integrity import check_scope_integrity

__all__ = [
    "scan_docx",
    "WordParagraphInfo",
    "WordDocumentInfo",
    "resolve_scope",
    "EditScope",
    "replace_text_in_paragraph",
    "replace_section_text",
    "insert_paragraph_after",
    "replace_entire_paragraph",
    "PROTECTED_TAGS",
    "is_protected_node",
    "check_complex_paragraph",
    "ChangeManifest",
    "check_scope_integrity",
]
