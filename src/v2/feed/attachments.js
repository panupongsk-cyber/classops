// Client-side copy of the server's attachment rules (server/src/attachments.ts), so a teacher
// learns about a file that will be refused before it is uploaded. The server still decides.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_POST = 5
export const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'docx', 'xlsx', 'pptx', 'txt']
export const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

/** The translation key for why this file cannot be attached, or null when it looks fine. */
export function attachmentProblem(file) {
  const dot = file.name.lastIndexOf('.')
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.includes(extension)) return 'attachError_UNSUPPORTED_FILE_TYPE'
  if (file.size === 0) return 'attachError_EMPTY_FILE'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'attachError_FILE_TOO_LARGE'
  return null
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const isImage = (contentType) => contentType.startsWith('image/')
