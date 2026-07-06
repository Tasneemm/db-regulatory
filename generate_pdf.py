from pathlib import Path

output = Path("app_explanation.pdf")

content_lines = [
    "Bank Compliance App Explanation",
    "",
    "This app is a compliance monitoring tool for a bank.",
    "",
    "In simple terms, it watches for new regulatory updates from European sources such as regulators, central banks, and news feeds.",
    "It collects these updates and checks whether they could affect the bank or its clients.",
    "",
    "The system works in two main steps:",
    "1. It gathers new regulatory news.",
    "2. It reviews whether the news is relevant and how serious it is.",
    "",
    "The result is a clear assessment that helps the bank understand:",
    "- whether the issue is relevant",
    "- how risky it is",
    "- what action the compliance team should take",
    "",
    "This is useful because regulatory changes can happen quickly, and missing them could create legal, financial, or reputational risks.",
    "",
    "In short, the app helps a bank stay informed, detect important regulatory changes early, and respond more effectively.",
]


def escape_pdf_text(value: str) -> str:
    return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


page_width = 612
page_height = 792
font_size = 12
title_size = 16

# Build content stream with simple text commands.
content_parts = []
# Title
content_parts.append(f"BT /F1 {title_size} Tf 50 760 Td ({escape_pdf_text(content_lines[0])}) Tj ET")
# Rest of lines
y = 732
for line in content_lines[1:]:
    if line == "":
        y -= 14
        continue
    content_parts.append(f"BT /F1 {font_size} Tf 50 {y} Td ({escape_pdf_text(line)}) Tj ET")
    y -= 14

content = "\n".join(content_parts).encode("latin-1", "replace")

objects = []

# Object 1: Catalog
objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
# Object 2: Pages
objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
# Object 3: Page
objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>")
# Object 4: Font
objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
# Object 5: Content stream
objects.append(b"<< /Length 0 >>")
# Need actual stream length; we'll build after with proper length.

# Rebuild object 5 with the real content as stream
stream_obj = f"<< /Length {len(content)} >>\nstream\n".encode("latin-1") + content + b"\nendstream"
objects[4] = stream_obj

# Build PDF file
pdf = bytearray()
pdf.extend(b"%PDF-1.4\n")
offsets = [0]
for obj in objects:
    offsets.append(len(pdf))
    pdf.extend(str(len(objects) - 1).encode())  # placeholder removed later

# Reconstruct properly
pdf = bytearray(b"%PDF-1.4\n")
offsets = []
for i, obj in enumerate(objects, start=1):
    offsets.append(len(pdf))
    pdf.extend(f"{i} 0 obj\n".encode("latin-1"))
    pdf.extend(obj + b"\nendobj\n")

xref_offset = len(pdf)
pdf.extend(f"xref\n0 {len(objects)+1}\n".encode("latin-1"))
pdf.extend(b"0000000000 65535 f \n")
for off in offsets:
    pdf.extend(f"{off:010d} 00000 n \n".encode("latin-1"))

pdf.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("latin-1"))

output.write_bytes(pdf)
print(f"Created {output}")
