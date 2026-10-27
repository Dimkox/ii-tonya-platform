import pymupdf
from helper import extract

def test_mixed_text_scan_keeps_text_but_marks_incomplete_without_ocr():
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((20, 40), 'Specialty: psychologist. ' * 4)
    image = page.get_pixmap().tobytes('png')
    scan = document.new_page()
    scan.insert_image(scan.rect, stream=image)
    result = extract(document.tobytes(), 'pdf', with_coverage=True)
    assert result['coverage'] == 'partial'
    assert 'Specialty: psychologist' in result['content']
    legacy = extract(document.tobytes(), 'pdf')
    assert set(legacy) == {'source', 'content'}
