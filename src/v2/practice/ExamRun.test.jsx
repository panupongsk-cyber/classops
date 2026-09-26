import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nContext.jsx'
import { translations } from '../i18n/translations.js'
import * as api from './api.js'
import ExamRun from './ExamRun.jsx'

vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  answerQuestion: vi.fn(),
  finishAttempt: vi.fn(),
  getAttempt: vi.fn(),
  setFlag: vi.fn(),
}))

const en = translations.en
// A save the test resolves by hand, to control the order the server sees.
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const question = (n) => ({
  id: `q${n}`, seq: n, examContentId: 'SYN', category: 'Synthetic',
  stem: { en: `Synthetic question ${n}` },
  options: ['a', 'b', 'c', 'd'].map((label) => ({ label, text: { en: `Choice ${label}` } })),
})
const data = { questions: [question(1), question(2)], selections: {}, flagged: [], serverNow: new Date().toISOString(), attempt: { deadlineAt: null } }

function renderExam(onFinished = vi.fn()) {
  render(<I18nProvider><ExamRun sectionId="s1" attemptId="a1" data={data} lang="en" onFinished={onFinished} /></I18nProvider>)
  return onFinished
}
const option = (label) => screen.getByRole('radio', { name: new RegExp(`Choice ${label}`) })

beforeEach(() => window.localStorage.setItem('classops_v2_lang', 'en'))
afterEach(cleanup)

describe('ExamRun saves', () => {
  it('sends answers one at a time in tap order, so the last tap is what the server keeps', async () => {
    const first = deferred()
    const second = deferred()
    api.answerQuestion.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    renderExam()
    fireEvent.click(option('b'))
    fireEvent.click(option('c'))
    await act(async () => {})
    expect(api.answerQuestion).toHaveBeenCalledTimes(1)
    expect(api.answerQuestion).toHaveBeenLastCalledWith('s1', 'a1', 'q1', 'b')
    expect(option('c').getAttribute('aria-checked')).toBe('true')
    await act(async () => { first.resolve({}) })
    expect(api.answerQuestion).toHaveBeenCalledTimes(2)
    expect(api.answerQuestion).toHaveBeenLastCalledWith('s1', 'a1', 'q1', 'c')
    await act(async () => { second.resolve({}) })
  })

  it('tapping the chosen option again clears it', async () => {
    api.answerQuestion.mockResolvedValue({})
    renderExam()
    fireEvent.click(option('a'))
    await act(async () => {})
    fireEvent.click(option('a'))
    await act(async () => {})
    expect(api.answerQuestion).toHaveBeenLastCalledWith('s1', 'a1', 'q1', null)
    expect(option('a').getAttribute('aria-checked')).toBe('false')
  })

  it('Submit waits for a save still in flight before finishing the attempt', async () => {
    const save = deferred()
    api.answerQuestion.mockReturnValueOnce(save.promise)
    api.finishAttempt.mockResolvedValue({})
    const onFinished = renderExam()
    fireEvent.click(option('d'))
    fireEvent.click(screen.getAllByRole('button', { name: en.examSubmit })[0])
    fireEvent.click(screen.getByRole('button', { name: en.examSubmitConfirm }))
    await act(async () => {})
    expect(api.finishAttempt).not.toHaveBeenCalled()
    await act(async () => { save.resolve({}) })
    expect(api.finishAttempt).toHaveBeenCalledWith('s1', 'a1')
    expect(onFinished).toHaveBeenCalled()
  })

  it('shows the server state after a failed save instead of guessing', async () => {
    api.answerQuestion.mockRejectedValueOnce(new Error('network'))
    api.getAttempt.mockResolvedValue({ attempt: { status: 'in_progress' }, selections: { q1: 'a' } })
    renderExam()
    fireEvent.click(option('b'))
    await act(async () => {})
    expect(screen.getByText(en.examSaveFailed)).toBeTruthy()
    expect(option('a').getAttribute('aria-checked')).toBe('true')
    expect(option('b').getAttribute('aria-checked')).toBe('false')
  })
})
