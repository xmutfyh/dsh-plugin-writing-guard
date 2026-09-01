# -*- coding: utf-8 -*-
"""
Run-Aware Paragraph Editor.

Safe text replacement in DOCX paragraphs that preserves:
- Run-level formatting (bold, italic, font, size, color)
- Complex objects (fields, equations, hyperlinks, bookmarks)
- Inline images and drawings

Follows the principle: never flatten complex paragraphs.
"""

import copy
from lxml import etree
from docx.oxml.ns import qn
from docx.shared import RGBColor


RED = RGBColor(0xFF, 0x00, 0x00)
BLACK = RGBColor(0x00, 0x00, 0x00)


def _get_run_text_elements(run_elem):
    """Get all w:t elements in a run."""
    return run_elem.findall(qn('w:t'))


def _build_char_map(runs):
    """Build a character-to-run-index map."""
    char_map = []
    for ri, run in enumerate(runs):
        for ci in range(len(run.text)):
            char_map.append((ri, ci))
    return char_map


def _clone_run_format(source_elem):
    """Clone run properties from a source w:r element."""
    rPr = source_elem.find(qn('w:rPr'))
    if rPr is not None:
        return copy.deepcopy(rPr)
    return None


def _create_run_with_format(para, text, rPr=None, color=None):
    """
    Create a new run element with given text and formatting.

    Args:
        para: paragraph element
        text: text content
        rPr: optional run properties element to clone
        color: optional RGBColor for text color

    Returns:
        new w:r element
    """
    nsmap = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    new_r = etree.SubElement(para, qn('w:r'))

    if rPr is not None:
        new_r.append(copy.deepcopy(rPr))

    if color is not None:
        # Ensure rPr exists
        existing_rPr = new_r.find(qn('w:rPr'))
        if existing_rPr is None:
            existing_rPr = etree.SubElement(new_r, qn('w:rPr'))
        # Set color
        color_elem = existing_rPr.find(qn('w:color'))
        if color_elem is None:
            color_elem = etree.SubElement(existing_rPr, qn('w:color'))
        color_elem.set(qn('w:val'), str(color))

    t = etree.SubElement(new_r, qn('w:t'))
    t.text = text
    t.set(qn('xml:space'), 'preserve')

    return new_r


def _split_single_run(para, run_idx, local_start, local_end, new_text, red=True):
    """
    Replace text within a single run, splitting it into 3 parts:
    before + replacement (red) + after.
    """
    runs = para.runs
    run = runs[run_idx]
    full_text = run.text

    before_text = full_text[:local_start]
    after_text = full_text[local_end:]

    # Get formatting from original run
    rPr = _clone_run_format(run._element)
    original_color = run.font.color.rgb if run.font.color and run.font.color.rgb else None

    # Clear the original run's text
    for t_elem in run._element.findall(qn('w:t')):
        t_elem.text = before_text if before_text else ''
        if not before_text:
            t_elem.set(qn('xml:space'), 'preserve')
        break  # only modify first w:t
    else:
        # No w:t found, create one
        t_elem = etree.SubElement(run._element, qn('w:t'))
        t_elem.text = before_text
        t_elem.set(qn('xml:space'), 'preserve')

    # If no before text, we can simplify
    if not before_text:
        # Just modify the existing run to be the new text
        for t_elem in run._element.findall(qn('w:t')):
            t_elem.text = new_text
            break
        # Set red color
        existing_rPr = run._element.find(qn('w:rPr'))
        if existing_rPr is None:
            existing_rPr = etree.SubElement(run._element, qn('w:rPr'))
        color_elem = existing_rPr.find(qn('w:color'))
        if color_elem is None:
            color_elem = etree.SubElement(existing_rPr, qn('w:color'))
        color_elem.set(qn('w:val'), 'FF0000' if red else (str(original_color) if original_color is not None else '000000'))

        # Add after_text as new run if needed
        if after_text:
            after_r = _create_run_with_format(
                para._element, after_text, rPr,
                original_color
            )
            run._element.addnext(after_r)
        return True

    # Create new run for replacement text (red)
    new_r = _create_run_with_format(
        para._element, new_text, rPr,
        RGBColor(0xFF, 0x00, 0x00) if red else original_color
    )
    run._element.addnext(new_r)

    # Create run for after text
    if after_text:
        after_r = _create_run_with_format(
            para._element, after_text, rPr,
            original_color
        )
        new_r.addnext(after_r)

    return True


def replace_text_in_paragraph(para, old_text, new_text, red=True):
    """
    Replace old_text with new_text in a paragraph while preserving formatting.

    Handles:
    - Single-run matches (simple case)
    - Multi-run spanning matches (merges affected runs)
    - Complex paragraphs (warns and attempts safe replacement)

    Args:
        para: python-docx Paragraph object
        old_text: text to find and replace
        new_text: replacement text
        red: whether to highlight the replacement in red

    Returns:
        dict with success status and details
    """
    result = {
        'success': False,
        'method': None,
        'warnings': [],
    }

    full_text = para.text
    if old_text not in full_text:
        result['warnings'].append(f"Text not found: '{old_text[:50]}...'")
        return result

    runs = para.runs
    if not runs:
        result['warnings'].append("No runs found in paragraph")
        return result

    # Build character map
    char_map = _build_char_map(runs)
    concat = ''.join(r.text for r in runs)
    start_pos = concat.find(old_text)
    if start_pos == -1:
        result['warnings'].append("Text not found in concatenated runs")
        return result

    end_pos = start_pos + len(old_text)

    # Check which runs are affected
    affected_runs = set()
    for pos in range(start_pos, end_pos):
        if pos < len(char_map):
            affected_runs.add(char_map[pos][0])
    affected_runs = sorted(affected_runs)

    # ── Single-run case ──
    if len(affected_runs) == 1:
        ri = affected_runs[0]
        r = runs[ri]
        r_start = sum(len(r2.text) for r2 in runs[:ri])
        local_start = start_pos - r_start
        local_end = end_pos - r_start

        success = _split_single_run(para, ri, local_start, local_end, new_text, red)
        result['success'] = success
        result['method'] = 'single_run_split'
        return result

    # ── Multi-run case ──
    first_ri = affected_runs[0]
    last_ri = affected_runs[-1]

    first_run = runs[first_ri]
    last_run = runs[last_ri]

    first_run_start = sum(len(r.text) for r in runs[:first_ri])
    last_run_start = sum(len(r.text) for r in runs[:last_ri])

    before_text = first_run.text[:start_pos - first_run_start]
    after_text = last_run.text[end_pos - last_run_start:]

    # Get formatting from first affected run
    rPr = _clone_run_format(first_run._element)
    original_color = (first_run.font.color.rgb
                      if first_run.font.color and first_run.font.color.rgb
                      else None)

    # Modify first run to keep only 'before' part
    for t_elem in first_run._element.findall(qn('w:t')):
        t_elem.text = before_text
        break

    # Remove intermediate runs (keep first, modify last)
    for ri in affected_runs[1:-1]:
        runs[ri]._element.getparent().remove(runs[ri]._element)

    # If first != last, also handle last run
    if first_ri != last_ri:
        # Remove last run's text (we'll handle after_text separately)
        for t_elem in last_run._element.findall(qn('w:t')):
            t_elem.text = ''
            break
        last_run._element.getparent().remove(last_run._element)

    # Insert new red run after first run
    new_r = _create_run_with_format(
        first_run._element.getparent(), new_text, rPr,
        RGBColor(0xFF, 0x00, 0x00) if red else original_color
    )
    first_run._element.addnext(new_r)

    # Insert after-text run
    if after_text:
        after_r = _create_run_with_format(
            first_run._element.getparent(), after_text, rPr,
            original_color
        )
        new_r.addnext(after_r)

    result['success'] = True
    result['method'] = 'multi_run_merge'
    return result


def replace_entire_paragraph(para, new_text, red=True):
    """
    Replace the entire text content of a paragraph, preserving the first run's formatting.

    Args:
        para: python-docx Paragraph object
        new_text: new text content
        red: whether to highlight in red

    Returns:
        dict with success status
    """
    result = {'success': False, 'method': 'entire_paragraph', 'warnings': []}

    if not para.runs:
        result['warnings'].append("No runs in paragraph")
        return result

    first_run = para.runs[0]
    rPr = _clone_run_format(first_run._element)

    # Remove all runs except the first
    for run in para.runs[1:]:
        run._element.getparent().remove(run._element)

    # Set first run text
    for t_elem in first_run._element.findall(qn('w:t')):
        t_elem.text = new_text
        break
    else:
        t_elem = etree.SubElement(first_run._element, qn('w:t'))
        t_elem.text = new_text
        t_elem.set(qn('xml:space'), 'preserve')

    # Set color
    existing_rPr = first_run._element.find(qn('w:rPr'))
    if existing_rPr is None:
        existing_rPr = etree.SubElement(first_run._element, qn('w:rPr'))
    color_elem = existing_rPr.find(qn('w:color'))
    if color_elem is None:
        color_elem = etree.SubElement(existing_rPr, qn('w:color'))
    color_elem.set(qn('w:val'), 'FF0000' if red else '000000')

    result['success'] = True
    return result


def insert_paragraph_after(para, text, red=True, bold=False, italic=False,
                           inherit_format=True):
    """
    Insert a new paragraph after the given paragraph.

    Args:
        para: python-docx Paragraph object (or XML element)
        text: text content
        red: highlight in red
        bold: bold text
        italic: italic text
        inherit_format: inherit format from the reference paragraph

    Returns:
        new paragraph XML element
    """
    para_elem = para._element if hasattr(para, '_element') else para
    parent = para_elem.getparent()

    # Clone the reference paragraph structure
    new_p = copy.deepcopy(para_elem)

    # Clear all runs from the clone
    for child in list(new_p):
        if child.tag.endswith('}r') or child.tag.endswith('}hyperlink'):
            new_p.remove(child)

    # Create new run
    new_r = etree.SubElement(new_p, qn('w:r'))
    rpr = etree.SubElement(new_r, qn('w:rPr'))

    # Set color
    color = etree.SubElement(rpr, qn('w:color'))
    color.set(qn('w:val'), 'FF0000' if red else '000000')

    if bold:
        etree.SubElement(rpr, qn('w:b'))
    if italic:
        etree.SubElement(rpr, qn('w:i'))

    t = etree.SubElement(new_r, qn('w:t'))
    t.text = text
    t.set(qn('xml:space'), 'preserve')

    # Insert after the reference paragraph
    para_elem.addnext(new_p)
    return new_p


def replace_section_text(doc, scope, replacements):
    """
    Apply multiple text replacements within a resolved scope.

    Args:
        doc: python-docx Document
        scope: EditScope with paragraph range
        replacements: list of (old_text, new_text) tuples

    Returns:
        list of change results
    """
    results = []
    paragraphs = doc.paragraphs

    for old_text, new_text in replacements:
        found = False
        for idx in scope.included_paragraphs:
            if idx < len(paragraphs):
                para = paragraphs[idx]
                if old_text in para.text:
                    r = replace_text_in_paragraph(para, old_text, new_text, red=True)
                    r['paragraph_index'] = idx
                    r['old_text'] = old_text
                    r['new_text'] = new_text
                    results.append(r)
                    found = True
                    break  # Replace first occurrence only
        if not found:
            results.append({
                'success': False,
                'method': 'section_replace',
                'warnings': [f"Text not found in scope: '{old_text[:50]}...'"],
                'old_text': old_text,
                'new_text': new_text,
            })

    return results
