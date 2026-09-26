import { describe, expect, it } from 'vitest'
import { t } from '../i18n/translations.js'
import { practiceErrorText } from './PracticePage.jsx'

describe('practiceErrorText', () => {
  const en = (key, values) => t('en', key, values)
  it('uses the code-specific message when there is one', () => {
    expect(practiceErrorText(en, 'NO_BOOKMARKS')).toBe(t('en', 'practiceError_NO_BOOKMARKS'))
  })
  it('falls back to the generic error instead of showing a raw key', () => {
    for (const code of ['PRACTICE_NOT_ENABLED', 'FORBIDDEN', 'SECTION_NOT_FOUND', 'SOMETHING_NEW']) {
      expect(practiceErrorText(en, code)).toBe(t('en', 'genericError'))
    }
  })
})
