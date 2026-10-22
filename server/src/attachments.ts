// Class Feed attachments (#2438): which files are accepted, decided from the bytes, not from what
// the browser claims. Decisions (Panupong, 2026-10-22): staff attach to posts only; PDF, images
// (PNG/JPEG/GIF/WebP), Office (DOCX/XLSX/PPTX) and plain text; up to 10 MB each and 5 per post;
// files live in PostgreSQL so the existing pg_dump backup covers them.
//
// A file is accepted only when its extension and its leading bytes agree. SVG and HTML are never
// accepted (they can carry script), and nothing is ever served as text/html.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_POST = 5;
export const MAX_FILE_NAME_LENGTH = 200;

export type AttachmentKind = "image" | "file";

interface FileType {
  extensions: string[];
  contentType: string;
  kind: AttachmentKind;
  matches: (bytes: Uint8Array) => boolean;
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const ZIP = [0x50, 0x4b, 0x03, 0x04];

// Entry names from the ZIP central directory, or null when the archive's directory cannot be read.
// Only the directory counts: a name hidden in the archive comment or inside a member's data is not
// an entry.
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 22) return null;
  // End of central directory: 22 bytes plus a comment of up to 65,535 bytes, at the very end.
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= lowest; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  let at = buf.readUInt32LE(eocd + 16);
  if (at + size > eocd) return null;
  const names: string[] = [];
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > eocd || buf.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    if (at + 46 + nameLength > eocd) return null;
    names.push(buf.toString("utf8", at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// Members an Office file never needs and an archive could smuggle: programs, scripts, and other
// archives. (Embedded Office files, images and OLE .bin parts are normal and allowed.)
const FORBIDDEN_MEMBER = /\.(exe|dll|com|bat|cmd|scr|msi|ps1|vbs|vbe|js|jse|wsf|hta|jar|sh|app|zip|7z|rar|gz|tgz|tar)$/i;

// An Office Open XML file is a ZIP whose central directory lists `[Content_Types].xml` and the
// type's main part. A plain ZIP renamed to .docx has neither, and is refused, as is any archive
// that carries a program, script or nested archive.
function isOoxml(bytes: Uint8Array, mainPart: string) {
  if (!startsWith(bytes, ZIP)) return false;
  const names = zipEntryNames(bytes);
  if (!names) return false;
  return names.includes("[Content_Types].xml") && names.includes(mainPart) && !names.some((name) => FORBIDDEN_MEMBER.test(name));
}

function isPlainText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const FILE_TYPES: FileType[] = [
  { extensions: ["png"], contentType: "image/png", kind: "image", matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { extensions: ["jpg", "jpeg"], contentType: "image/jpeg", kind: "image", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { extensions: ["gif"], contentType: "image/gif", kind: "image", matches: (b) => startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a")) },
  { extensions: ["webp"], contentType: "image/webp", kind: "image", matches: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8) },
  { extensions: ["pdf"], contentType: "application/pdf", kind: "file", matches: (b) => startsWith(b, ascii("%PDF-")) },
  {
    extensions: ["docx"],
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "file",
    matches: (b) => isOoxml(b, "word/document.xml"),
  },
  {
    extensions: ["xlsx"],
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "file",
    matches: (b) => isOoxml(b, "xl/workbook.xml"),
  },
  {
    extensions: ["pptx"],
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "file",
    matches: (b) => isOoxml(b, "ppt/presentation.xml"),
  },
  { extensions: ["txt"], contentType: "text/plain; charset=utf-8", kind: "file", matches: isPlainText },
];

/** Every content type this module can return; the migration's CHECK lists the same set. */
export const ALLOWED_CONTENT_TYPES = [...new Set(FILE_TYPES.map((type) => type.contentType))];

/**
 * A safe display name: no directory part, no control or bidi-override characters, trimmed, and
 * at most 200 characters with the extension kept. Null when nothing usable is left.
 */
export function cleanFileName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, MAX_FILE_NAME_LENGTH - extension.length) + extension;
}

/** The accepted type for these bytes under this name, or null when the file is not allowed. */
export function detectAttachmentType(fileName: string, bytes: Uint8Array): { contentType: string; kind: AttachmentKind } | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = fileName.slice(dot + 1).toLowerCase();
  const type = FILE_TYPES.find((candidate) => candidate.extensions.includes(extension));
  if (!type || !type.matches(bytes)) return null;
  return { contentType: type.contentType, kind: type.kind };
}

export function kindOf(contentType: string): AttachmentKind {
  return contentType.startsWith("image/") ? "image" : "file";
}

/**
 * Content-Disposition for a download: an ASCII fallback name plus the RFC 5987 UTF-8 name, so
 * Thai file names survive while quotes and non-ASCII never break the header.
 */
export function contentDisposition(disposition: "inline" | "attachment", fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
