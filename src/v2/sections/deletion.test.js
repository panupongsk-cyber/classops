import { describe, expect, it } from 'vitest'
import { t } from '../i18n/translations.js'
import { ApiError } from '../auth/api.js'
import { blockerSummary, courseDeleteError, sectionDeleteError } from './deletion.js'

const en = (key, values) => t('en', key, values)

describe('blockerSummary', () => {
  it('names each blocker in the reader’s language and counts it', () => {
    const summary = blockerSummary(en, [
      { resource: 'students', count: 2 },
      { resource: 'practiceAttempts', count: 5 },
    ])
    expect(summary).toContain(t('en', 'deleteBlocker_students'))
    expect(summary).toContain('(2)')
    expect(summary).toContain(t('en', 'deleteBlocker_practiceAttempts'))
    expect(summary).toContain('(5)')
  })

  it('never shows a raw resource key for an unknown blocker', () => {
    expect(blockerSummary(en, [{ resource: 'future_table', count: 1 }])).toBe(
      `${t('en', 'deleteBlocker_other')} (1)`,
    )
  })

  it('is empty when nothing blocks', () => {
    expect(blockerSummary(en, [])).toBe('')
  })
})

describe('delete errors', () => {
  it('explains a refused Section delete instead of showing a raw code', () => {
    const error = new ApiError('SECTION_NOT_EMPTY', 409, [], {
      error: 'SECTION_NOT_EMPTY',
      blockers: [{ resource: 'sessions', count: 1 }],
    })
    expect(sectionDeleteError(en, error)).toContain(t('en', 'deleteBlocker_sessions'))
  })

  it('names the Sections that block a Course delete', () => {
    const error = new ApiError('COURSE_NOT_EMPTY', 409, [], {
      error: 'COURSE_NOT_EMPTY',
      sections: [{ sectionId: 's1', term: '2569/1', label: '801', blockers: [] }],
    })
    expect(courseDeleteError(en, error)).toContain('801 (2569/1)')
  })

  it('falls back to the generic message for anything else', () => {
    expect(sectionDeleteError(en, new ApiError('FORBIDDEN', 403))).toBe(t('en', 'genericError'))
    expect(courseDeleteError(en, new Error('boom'))).toBe(t('en', 'genericError'))
  })
})
