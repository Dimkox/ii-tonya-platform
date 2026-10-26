import io
from pathlib import Path
import pymupdf
from docx import Document
out=Path('/tmp/residency-private-parser-20261026')
font=pymupdf.Font(fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
pdf=pymupdf.open();page=pdf.new_page(width=600,height=400);writer=pymupdf.TextWriter(page.rect)
for y,text in [(70,'Специальность: Психолог'),(120,'Учебное заведение: Университет'),(170,'Год: 2020'),(220,'Город: Казань')]:writer.append((30,y),text,font=font,fontsize=24)
writer.write_text(page);out.joinpath('text.pdf').write_bytes(pdf.tobytes())
pix=page.get_pixmap(dpi=150);out.joinpath('scan.png').write_bytes(pix.tobytes('png'))
scan=pymupdf.open();p=scan.new_page(width=600,height=400);p.insert_image(p.rect,stream=pix.tobytes('png'));out.joinpath('scan.pdf').write_bytes(scan.tobytes())
doc=Document();doc.add_paragraph('Город: Казань\nСпециализация: Психолог\nМетоды: Консультации\nОпыт: 12');b=io.BytesIO();doc.save(b);out.joinpath('brief.docx').write_bytes(b.getvalue())
