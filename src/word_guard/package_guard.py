# -*- coding: utf-8 -*-
"""OOXML package integrity utilities for DOCX safe editing.

The guard deliberately treats a .docx as an OPC/OOXML package rather than as
plain text.  It validates XML parts, relationship targets, and unexpected
changes to package parts that should remain byte-identical for text-only edits.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from hashlib import sha256
from pathlib import PurePosixPath
from typing import Iterable
import posixpath
import zipfile

from lxml import etree

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


@dataclass
class PackageValidation:
    valid: bool = True
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    xml_parts_checked: int = 0
    relationships_checked: int = 0
    orphan_media: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def _is_xml_part(name: str) -> bool:
    return name.endswith('.xml') or name.endswith('.rels')


def _normalize_rel_target(rels_part: str, target: str) -> str:
    """Resolve a relationship target to a ZIP package part path."""
    if target.startswith('/'):
        return target.lstrip('/')
    if rels_part == '_rels/.rels':
        base = ''
    else:
        # e.g. word/_rels/document.xml.rels -> word/
        parent = str(PurePosixPath(rels_part).parent.parent)
        base = '' if parent == '.' else parent + '/'
    return posixpath.normpath(base + target)


def validate_docx_package(path: str) -> PackageValidation:
    result = PackageValidation()
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            required = {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'}
            missing = sorted(required - names)
            if missing:
                result.errors.append(f"Missing required package parts: {missing}")

            # Parse every XML-ish part. This catches malformed XML after direct edits.
            for name in sorted(names):
                if not _is_xml_part(name):
                    continue
                try:
                    etree.fromstring(zf.read(name))
                    result.xml_parts_checked += 1
                except Exception as exc:
                    result.errors.append(f"Malformed XML part {name}: {exc}")

            referenced_media = set()
            for rels_name in sorted(n for n in names if n.endswith('.rels')):
                try:
                    root = etree.fromstring(zf.read(rels_name))
                except Exception:
                    continue
                for rel in root.findall(f'{{{REL_NS}}}Relationship'):
                    result.relationships_checked += 1
                    if rel.get('TargetMode') == 'External':
                        continue
                    target = rel.get('Target') or ''
                    resolved = _normalize_rel_target(rels_name, target)
                    if resolved not in names:
                        result.errors.append(
                            f"Broken relationship in {rels_name}: {target} -> {resolved}"
                        )
                    if resolved.startswith('word/media/'):
                        referenced_media.add(resolved)

            media = {n for n in names if n.startswith('word/media/') and not n.endswith('/')}
            orphan = sorted(media - referenced_media)
            if orphan:
                result.orphan_media = orphan
                result.warnings.append(
                    f"{len(orphan)} orphan media part(s) are not referenced by any relationship"
                )
    except zipfile.BadZipFile as exc:
        result.errors.append(f"Invalid DOCX/ZIP package: {exc}")
    except Exception as exc:
        result.errors.append(f"Package validation failed: {exc}")

    result.valid = not result.errors
    return result


def part_hashes(path: str) -> dict[str, str]:
    """Return SHA-256 hashes for every non-directory package part."""
    with zipfile.ZipFile(path) as zf:
        return {
            name: sha256(zf.read(name)).hexdigest()
            for name in sorted(zf.namelist())
            if not name.endswith('/')
        }


def compare_package_parts(before: str, after: str, allowed_changed_parts: Iterable[str] | None = None) -> dict:
    """Detect unexpected package-part drift.

    For text-only editing, styles/settings/numbering/media/relationships should
    normally remain byte-identical.  The caller may allow document.xml and
    metadata parts that Word/python-docx legitimately rewrites.
    """
    allowed = set(allowed_changed_parts or ())
    hb = part_hashes(before)
    ha = part_hashes(after)
    before_parts, after_parts = set(hb), set(ha)

    added = sorted(after_parts - before_parts)
    removed = sorted(before_parts - after_parts)
    changed = sorted(
        p for p in before_parts & after_parts
        if hb[p] != ha[p]
    )
    unexpected_changed = [p for p in changed if p not in allowed]
    unexpected_added = [p for p in added if p not in allowed]
    unexpected_removed = [p for p in removed if p not in allowed]

    return {
        'intact': not (unexpected_changed or unexpected_added or unexpected_removed),
        'changed_parts': changed,
        'added_parts': added,
        'removed_parts': removed,
        'unexpected_changed_parts': unexpected_changed,
        'unexpected_added_parts': unexpected_added,
        'unexpected_removed_parts': unexpected_removed,
    }
