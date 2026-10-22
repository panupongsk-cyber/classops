import { describe, expect, it } from 'vitest'
import { attachmentProblem, formatBytes, isImage, MAX_ATTACHMENT_BYTES } from './attachments.js'

const file = (name, size) => ({ name, size })

describe('attachmentProblem', () => {
  it('accepts the allowed types, any case, within the size limit', () => {
    for (const name of ['a.pdf', 'b.PNG', 'c.jpeg', 'd.docx', 'e.xlsx', 'f.pptx', 'g.txt', 'h.webp', 'i.gif', 'j.jpg']) {
      expect(attachmentProblem(file(name, 10))).toBe(null)
    }
  })
  it('names the reason a file would be refused', () => {
    expect(attachmentProblem(file('drawing.svg', 10))).toBe('attachError_UNSUPPORTED_FILE_TYPE')
    expect(attachmentProblem(file('noextension', 10))).toBe('attachError_UNSUPPORTED_FILE_TYPE')
    expect(attachmentProblem(file('a.pdf', 0))).toBe('attachError_EMPTY_FILE')
    expect(attachmentProblem(file('a.pdf', MAX_ATTACHMENT_BYTES + 1))).toBe('attachError_FILE_TOO_LARGE')
    expect(attachmentProblem(file('a.pdf', MAX_ATTACHMENT_BYTES))).toBe(null)
  })
})

describe('formatBytes and isImage', () => {
  it('formats sizes and tells images apart', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '3.0 MB'])
    expect([isImage('image/png'), isImage('application/pdf')]).toEqual([true, false])
  })
})
