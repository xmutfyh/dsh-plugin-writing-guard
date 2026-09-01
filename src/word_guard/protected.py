# -*- coding: utf-8 -*-
"""
Protected Node Policy.

Defines which XML nodes and document elements must never be modified
during editing operations, and provides helpers for checking
complex paragraph status.
"""

from docx.oxml.ns import qn


# ── Protected XML Tags ────────────────────────────────────────────────────
# These nodes must never be deleted, modified, or recreated unless
# the user explicitly requests it.

PROTECTED_TAGS = {
    # Section properties
    'sectPr': qn('w:sectPr'),

    # Bookmarks
    'bookmarkStart': qn('w:bookmarkStart'),
    'bookmarkEnd': qn('w:bookmarkEnd'),

    # Fields (cross-references, TOC, etc.)
    'fldChar': qn('w:fldChar'),
    'instrText': qn('w:instrText'),
    'fldSimple': qn('w:fldSimple'),

    # Images and drawings
    'drawing': qn('w:drawing'),
    'pict': qn('w:pict'),
    'object': qn('w:object'),

    # Hyperlinks
    'hyperlink': qn('w:hyperlink'),

    # Footnotes and endnotes
    'footnoteReference': qn('w:footnoteReference'),
    'endnoteReference': qn('w:endnoteReference'),
    'footnote': qn('w:footnote'),
    'endnote': qn('w:endnote'),

    # Comments
    'commentReference': qn('w:commentReference'),
    'commentStart': qn('w:commentRangeStart'),
    'commentEnd': qn('w:commentRangeEnd'),
    'comment': qn('w:comment'),

    # Equations
    'oMath': qn('m:oMath'),
    'oMathPara': qn('m:oMathPara'),

    # Table structure
    'tbl': qn('w:tbl'),
    'tr': qn('w:tr'),
    'tc': qn('w:tc'),

    # Page setup
    'pgSz': qn('w:pgSz'),
    'pgMar': qn('w:pgMar'),
    'cols': qn('w:cols'),

    # Headers and footers
    'hdr': qn('w:hdr'),
    'ftr': qn('w:ftr'),
}


def is_protected_node(element):
    """
    Check if an XML element is a protected node that must not be modified.

    Args:
        element: lxml etree element

    Returns:
        True if the element is protected
    """
    if element is None:
        return False
    tag = element.tag
    for protected_tag in PROTECTED_TAGS.values():
        if tag == protected_tag:
            return True
    return False


def check_complex_paragraph(para):
    """
    Check if a paragraph is complex (contains protected objects).

    A complex paragraph requires run-aware or XML-aware editing.
    Simple text replacement should NOT be used on complex paragraphs.

    Args:
        para: python-docx Paragraph object

    Returns:
        dict with complexity analysis
    """
    elem = para._element if hasattr(para, '_element') else para

    result = {
        'is_complex': False,
        'has_equation': False,
        'has_drawing': False,
        'has_field': False,
        'has_hyperlink': False,
        'has_bookmark': False,
        'has_footnote': False,
        'has_comment': False,
        'protected_nodes': [],
        'risk_level': 'low',  # low / medium / high
    }

    # Check for equations
    eq = elem.find('.//' + qn('m:oMath'))
    eq_para = elem.find('.//' + qn('m:oMathPara'))
    if eq is not None or eq_para is not None:
        result['has_equation'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('equation')

    # Check for drawings/images
    drawing = elem.find('.//' + qn('w:drawing'))
    if drawing is not None:
        result['has_drawing'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('drawing')

    # Check for fields
    fld_char = elem.find('.//' + qn('w:fldChar'))
    instr = elem.find('.//' + qn('w:instrText'))
    if fld_char is not None or instr is not None:
        result['has_field'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('field')

    # Check for hyperlinks
    hyperlink = elem.find(qn('w:hyperlink'))
    if hyperlink is not None:
        result['has_hyperlink'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('hyperlink')

    # Check for bookmarks
    bm_start = elem.find('.//' + qn('w:bookmarkStart'))
    if bm_start is not None:
        result['has_bookmark'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('bookmark')

    # Check for footnotes
    fn_ref = elem.find('.//' + qn('w:footnoteReference'))
    if fn_ref is not None:
        result['has_footnote'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('footnote')

    # Check for comments
    cm_ref = elem.find('.//' + qn('w:commentReference'))
    if cm_ref is not None:
        result['has_comment'] = True
        result['is_complex'] = True
        result['protected_nodes'].append('comment')

    # Determine risk level
    if result['has_equation'] or result['has_field']:
        result['risk_level'] = 'high'
    elif result['has_drawing'] or result['has_hyperlink'] or result['has_bookmark']:
        result['risk_level'] = 'medium'
    else:
        result['risk_level'] = 'low'

    return result


def get_protected_elements_in_range(doc, start_idx, end_idx):
    """
    Find all protected elements within a paragraph range.

    Args:
        doc: python-docx Document
        start_idx: start paragraph index (inclusive)
        end_idx: end paragraph index (exclusive)

    Returns:
        list of dicts describing protected elements found
    """
    protected = []

    for i in range(start_idx, min(end_idx, len(doc.paragraphs))):
        para = doc.paragraphs[i]
        check = check_complex_paragraph(para)
        if check['is_complex']:
            protected.append({
                'paragraph_index': i,
                'text_preview': para.text[:80],
                'protected_nodes': check['protected_nodes'],
                'risk_level': check['risk_level'],
            })

    return protected
