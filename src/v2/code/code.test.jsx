import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../auth/api.js'
import { I18nProvider } from '../i18n/I18nContext.jsx'
import { t } from '../i18n/translations.js'
import CodeEditor from './CodeEditor.jsx'
import { TestResults } from './CodeExercisePage.jsx'
import { codeErrorText, insertIndent, toPayloadTests } from './helpers.js'

afterEach(cleanup)
const th = (key, values) => t('th', key, values)

describe('code exercise helpers', () => {
  it('maps runner errors to friendly Thai text and unknown codes to the generic error', () => {
    expect(codeErrorText(th, new ApiError('CODE_RUNNER_NOT_CONFIGURED', 503))).toBe('ระบบรันโค้ดไม่พร้อมใช้งานในขณะนี้')
    expect(codeErrorText(th, 'CODE_RUNNER_BUSY')).toBe(t('th', 'codeError_RUNNER_BUSY'))
    expect(codeErrorText(th, 'SOMETHING_NEW')).toBe(t('th', 'genericError'))
  })
  it('inserts four spaces over the selection', () => {
    expect(insertIndent('ab', 1, 1)).toEqual({ value: 'a    b', cursor: 5 })
    expect(insertIndent('abcd', 1, 3)).toEqual({ value: 'a    d', cursor: 5 })
  })
  it('drops an empty test name', () => {
    expect(toPayloadTests([{ name: ' ', stdin: '1', expected_stdout: '2' }, { name: 'n', stdin: '', expected_stdout: '' }]))
      .toEqual([{ stdin: '1', expected_stdout: '2' }, { name: 'n', stdin: '', expected_stdout: '' }])
  })
})

function Harness() {
  const [value, setValue] = useState('x')
  return <CodeEditor label="code" value={value} onChange={setValue} />
}

describe('CodeEditor', () => {
  it('is monospace-styled, spellcheck off, and Tab inserts spaces', () => {
    render(<I18nProvider><Harness /></I18nProvider>)
    const box = screen.getByLabelText('code')
    expect(box.getAttribute('spellcheck')).toBe('false')
    box.setSelectionRange(1, 1)
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box.value).toBe('x    ')
  })
})

describe('TestResults', () => {
  it('renders a summary and per-test states', () => {
    render(
      <I18nProvider>
        <TestResults outcome={{ passedCount: 1, totalCount: 3, results: [
          { name: 'echo', passed: true, ran: true, stdout: 'hi', stderr: '', timedOut: false },
          { name: null, passed: false, ran: true, stdout: '', stderr: 'Traceback', timedOut: true },
          { name: null, passed: false, ran: false, stdout: '', stderr: '', timedOut: false },
        ] }} />
      </I18nProvider>,
    )
    expect(screen.getByText(t('th', 'codePassedSummary', { passed: 1, total: 3 }))).toBeTruthy()
    expect(screen.getByText('Traceback')).toBeTruthy()
    expect(screen.getByText(new RegExp(t('th', 'codeResultTimedOut')))).toBeTruthy()
    expect(screen.getByText(/หมดเวลารวม/)).toBeTruthy()
  })
})
