import io
import zipfile
import pymupdf
from docx import Document
from helper import extract

TEXT = "A private synthetic professional biography used for deterministic parser acceptance. " * 3

def test_real_text_pdf():
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 50), TEXT)
    assert len(extract(document.tobytes(), "pdf")["content"]) >= 50


def test_real_docx():
    document = Document()
    document.add_paragraph(TEXT)
    data = io.BytesIO()
    document.save(data)
    assert extract(data.getvalue(), "docx")["content"] == TEXT.strip()


def test_empty_scan_encrypted_and_page_limit():
    document = pymupdf.open()
    document.new_page()
    assert extract(document.tobytes(), "pdf") is None
    assert extract(document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="secret", user_pw="secret"), "pdf") is None
    for _ in range(40):
        document.new_page()
    assert extract(document.tobytes(), "pdf") is None


def test_expansion_and_xml_entities_rejected():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "x" * 100000)
    assert extract(data.getvalue(), "docx") is None
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("word/document.xml", '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///private">]>')
    assert extract(data.getvalue(), "docx") is None


def test_short_text():
    document = Document()
    document.add_paragraph("short")
    data = io.BytesIO()
    document.save(data)
    assert extract(data.getvalue(), "docx") is None
