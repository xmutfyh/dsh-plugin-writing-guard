# -*- coding: utf-8 -*-
"""
Change Manifest Generator.

Tracks all modifications made to a DOCX document and generates
a structured manifest for verification and audit purposes.
"""

import json
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class ChangeEntry:
    """A single change in the document."""
    change_type: str  # replace_text, insert_paragraph, replace_section, etc.
    target: str  # paragraph index, heading, section, etc.
    old_text: Optional[str] = None
    new_text: Optional[str] = None
    paragraph_index: Optional[int] = None
    method: Optional[str] = None  # single_run_split, multi_run_merge, etc.
    success: bool = True
    warnings: list = field(default_factory=list)


class ChangeManifest:
    """
    Tracks and reports all changes made during a DOCX editing session.

    Generates a structured manifest that can be used for:
    - Verification of scope integrity
    - Audit trail
    - Rebuttal "Location of revision" generation
    """

    def __init__(self, document_path, requested_scope=None):
        """
        Initialize a change manifest.

        Args:
            document_path: path to the DOCX file being edited
            requested_scope: description of the requested edit scope
        """
        self.document_path = document_path
        self.document_name = document_path.split('\\')[-1].split('/')[-1]
        self.requested_scope = requested_scope or "full document"
        self.changes: List[ChangeEntry] = []
        self.preserved: List[str] = []
        self.start_time = datetime.now()
        self.end_time = None

    def add_change(self, change_type, target, old_text=None, new_text=None,
                   paragraph_index=None, method=None, success=True, warnings=None):
        """Record a single change."""
        entry = ChangeEntry(
            change_type=change_type,
            target=target,
            old_text=old_text,
            new_text=new_text,
            paragraph_index=paragraph_index,
            method=method,
            success=success,
            warnings=warnings or [],
        )
        self.changes.append(entry)

    def add_preserved(self, element_description):
        """Record a preserved element."""
        if element_description not in self.preserved:
            self.preserved.append(element_description)

    def finalize(self):
        """Mark the editing session as complete."""
        self.end_time = datetime.now()

    def summary(self):
        """Generate a human-readable summary."""
        successful = sum(1 for c in self.changes if c.success)
        failed = sum(1 for c in self.changes if not c.success)

        lines = [
            f"Document: {self.document_name}",
            f"Requested scope: {self.requested_scope}",
            f"Total changes: {len(self.changes)} ({successful} succeeded, {failed} failed)",
            "",
            "Changes:",
        ]
        for i, c in enumerate(self.changes, 1):
            status = "✓" if c.success else "✗"
            lines.append(f"  {i}. [{status}] {c.change_type}: {c.target}")
            if c.old_text:
                lines.append(f"     Old: {c.old_text[:80]}...")
            if c.new_text:
                lines.append(f"     New: {c.new_text[:80]}...")
            if c.warnings:
                for w in c.warnings:
                    lines.append(f"     ⚠ {w}")

        if self.preserved:
            lines.append("")
            lines.append("Preserved elements:")
            for p in self.preserved:
                lines.append(f"  - {p}")

        return '\n'.join(lines)

    def to_dict(self):
        """Export manifest as a dictionary."""
        return {
            'document': self.document_name,
            'requested_scope': self.requested_scope,
            'timestamp': self.start_time.isoformat(),
            'changes': [
                {
                    'type': c.change_type,
                    'target': c.target,
                    'old_text': c.old_text,
                    'new_text': c.new_text,
                    'paragraph_index': c.paragraph_index,
                    'method': c.method,
                    'success': c.success,
                    'warnings': c.warnings,
                }
                for c in self.changes
            ],
            'preserved': self.preserved,
            'summary': {
                'total': len(self.changes),
                'succeeded': sum(1 for c in self.changes if c.success),
                'failed': sum(1 for c in self.changes if not c.success),
            }
        }

    def to_json(self, indent=2):
        """Export manifest as JSON."""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def to_markdown(self):
        """Export manifest as Markdown (useful for rebuttal location-of-revision)."""
        lines = [
            f"# Change Manifest: {self.document_name}",
            f"",
            f"**Requested scope:** {self.requested_scope}",
            f"",
            f"**Total changes:** {len(self.changes)}",
            f"",
            f"## Changes",
            f"",
            f"| # | Type | Target | Status |",
            f"|---|------|--------|--------|",
        ]
        for i, c in enumerate(self.changes, 1):
            status = "✓" if c.success else "✗"
            lines.append(f"| {i} | {c.change_type} | {c.target} | {status} |")

        if self.preserved:
            lines.append("")
            lines.append("## Preserved Elements")
            lines.append("")
            for p in self.preserved:
                lines.append(f"- {p}")

        return '\n'.join(lines)
