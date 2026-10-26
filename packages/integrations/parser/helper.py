"""Private stdin-only parser. No document paths, URLs, logging or network I/O."""
import io
import json
import resource
import sys
import zipfile

MAX_INPUT = 5 * 1024 * 1024
MAX_OUTPUT = 64000


def extract(data, kind):
    if not data or len(data) > MAX_INPUT:
        return None
    if kind == "pdf":
        import pymupdf
        with pymupdf.open(stream=data, filetype="pdf") as document:
            if document.needs_pass or len(document) > 40:
                return None
            parts = []
            total = 0
            for page in document:
                text = page.get_text()
                total += len(text.encode("utf-8"))
                if total > MAX_OUTPUT:
                    return None
                parts.append(text)
            text = "\n".join(parts)
    elif kind == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            items = archive.infolist()
            if len(items) > 256 or sum(i.file_size for i in items) > 20 * 1024 * 1024:
                return None
            if any(i.flag_bits & 1 or i.file_size > 10 * 1024 * 1024 or
                   i.file_size > max(1, i.compress_size) * 200 for i in items):
                return None
            # Block external entities/relationships before the XML library sees them.
            for item in items:
                if item.filename.endswith((".xml", ".rels")):
                    xml = archive.read(item).lower()
                    if b"<!doctype" in xml or b"<!entity" in xml or b'targetmode="external"' in xml:
                        return None
        from docx import Document
        document = Document(io.BytesIO(data))
        text = "\n".join([p.text for p in document.paragraphs] +
                         [cell.text for table in document.tables for row in table.rows for cell in row.cells])
    else:
        return None
    text = text.strip()
    if len(text) < 50 or len(text.encode("utf-8")) > MAX_OUTPUT:
        return None
    return {"source": kind, "content": text}


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
    try:
        data = sys.stdin.buffer.read(MAX_INPUT + 1)
        result = extract(data, sys.argv[1] if len(sys.argv) == 2 else "")
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
    except Exception:
        sys.stdout.write("null")


if __name__ == "__main__":
    main()
