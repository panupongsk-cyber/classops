import assert from "node:assert/strict";
import test from "node:test";

import { cleanFileName, contentDisposition, detectAttachmentType, MAX_FILE_NAME_LENGTH, zipEntryNames } from "../src/attachments.js";

// A minimal stored (uncompressed) ZIP: local headers, central directory, end record. CRCs are left
// at zero; the detector reads only the directory.
function makeZip(entries: { name: string; data?: string }[], comment = "") {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "x");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, "latin1");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return new Uint8Array(Buffer.concat([...locals, directory, end, commentBytes]));
}

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "rest");
const PDF = bytes("%PDF-1.7\n...");
const ooxml = (mainPart: string, extra: string[] = []) =>
  makeZip([{ name: "[Content_Types].xml" }, { name: "_rels/.rels" }, { name: mainPart }, ...extra.map((name) => ({ name }))]);
const DOCX = ooxml("word/document.xml");
const XLSX = ooxml("xl/workbook.xml");
const PPTX = ooxml("ppt/presentation.xml");
const PLAIN_ZIP = makeZip([{ name: "setup.exe", data: "MZ" }]);

test("a file is accepted only when its extension and leading bytes agree", () => {
  assert.deepEqual(detectAttachmentType("photo.PNG", PNG), { contentType: "image/png", kind: "image" });
  assert.deepEqual(detectAttachmentType("photo.jpeg", JPEG), { contentType: "image/jpeg", kind: "image" });
  assert.deepEqual(detectAttachmentType("a.gif", bytes("GIF89a....")), { contentType: "image/gif", kind: "image" });
  assert.deepEqual(detectAttachmentType("a.webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")), { contentType: "image/webp", kind: "image" });
  assert.equal(detectAttachmentType("slides.pdf", PDF)?.contentType, "application/pdf");
  assert.equal(detectAttachmentType("lab.docx", DOCX)?.kind, "file");
  assert.equal(detectAttachmentType("grades.xlsx", XLSX)?.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(detectAttachmentType("deck.pptx", PPTX)?.contentType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(detectAttachmentType("notes.txt", new TextEncoder().encode("บันทึก\nnotes"))?.contentType, "text/plain; charset=utf-8");
});

test("a mismatch, a missing extension, or a type outside the list is refused", () => {
  for (const [name, data] of [
    ["photo.jpg", PNG], // PNG bytes under a JPEG name
    ["slides.pdf", DOCX],
    ["archive.zip", PLAIN_ZIP],
    ["tools.docx", PLAIN_ZIP], // a plain ZIP renamed: no Office structure
    ["deck.pptx", DOCX], // a Word file renamed to PowerPoint
    ["drawing.svg", bytes("<svg xmlns='http://www.w3.org/2000/svg'></svg>")],
    ["page.html", bytes("<html><script>alert(1)</script></html>")],
    ["page.txt", bytes("ok", [0], "binary")], // NUL byte: not plain text
    ["latin1.txt", bytes([0xe9, 0x74, 0xe9])], // not valid UTF-8
    ["program.exe", bytes("MZ....")],
    ["noextension", PDF],
  ] as const) {
    assert.equal(detectAttachmentType(name, data), null, name);
  }
});

test("file names lose their directory, control and bidi characters, and keep their extension when cut", () => {
  assert.equal(cleanFileName("C:\\Users\\x\\แผนการสอน.pdf"), "แผนการสอน.pdf");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName("evil\u202Efdp.exe"), "evilfdp.exe");
  assert.equal(cleanFileName("a\u0000b\nc.txt"), "abc.txt");
  assert.equal(cleanFileName("   "), null);
  assert.equal(cleanFileName(".."), null);
  const long = cleanFileName(`${"x".repeat(400)}.pdf`)!;
  assert.equal(long.length, MAX_FILE_NAME_LENGTH);
  assert.ok(long.endsWith(".pdf"));
});

test("Content-Disposition carries an ASCII fallback and the exact UTF-8 name", () => {
  assert.equal(
    contentDisposition("attachment", `แผน "1" (v2).pdf`),
    `attachment; filename="___ _1_ (v2).pdf"; filename*=UTF-8''%E0%B9%81%E0%B8%9C%E0%B8%99%20%221%22%20%28v2%29.pdf`,
  );
  assert.equal(contentDisposition("inline", "a.png"), `inline; filename="a.png"; filename*=UTF-8''a.png`);
});

test("Office files are judged by their ZIP directory, not by strings anywhere in the bytes", () => {
  assert.deepEqual(zipEntryNames(DOCX), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
  // The names only in the archive comment, or only inside a member's data: not entries.
  const inComment = makeZip([{ name: "setup.exe", data: "MZ" }], "[Content_Types].xml word/document.xml");
  const inData = makeZip([{ name: "notes.bin", data: "[Content_Types].xml word/document.xml" }]);
  assert.equal(detectAttachmentType("a.docx", inComment), null);
  assert.equal(detectAttachmentType("a.docx", inData), null);
  // Real structure but a smuggled program, script or archive: refused.
  for (const extra of ["payload.exe", "word/media/run.ps1", "word/embeddings/inner.zip"]) {
    assert.equal(detectAttachmentType("a.docx", ooxml("word/document.xml", [extra])), null, extra);
  }
  // Ordinary Office parts, including an embedded workbook and an OLE object, are fine.
  assert.ok(detectAttachmentType("a.docx", ooxml("word/document.xml", ["word/embeddings/Microsoft_Excel_Worksheet.xlsx", "word/embeddings/oleObject1.bin", "word/media/image1.png"])));
  // Truncated or garbage after the ZIP magic: no directory, refused.
  assert.equal(zipEntryNames(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), null);
  assert.equal(detectAttachmentType("a.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), null);
});
