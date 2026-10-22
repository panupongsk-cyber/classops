import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { I18nProvider } from '../i18n/I18nContext.jsx'
import { ApiError, apiRequest } from '../auth/api.js'
import { t } from '../i18n/translations.js'
import PracticeSwitch from './PracticeSwitch.jsx'

vi.mock('../auth/api.js', () => ({ apiRequest: vi.fn(), apiUrl: (p) => p, ApiError: class extends Error { constructor(code, status) { super(code); this.code = code; this.status = status } } }))

const show = (props) => render(<I18nProvider><PracticeSwitch sectionId="S1" {...props} /></I18nProvider>)
const either = (key) => new RegExp(`${t('th', key)}|${t('en', key)}`.replace(/[().]/g, '\\$&'))

beforeEach(() => { localStorage.clear(); apiRequest.mockReset() })
afterEach(cleanup)

test('a TA sees the state and a note, never a switch (#1995)', () => {
  show({ enabled: false, canToggle: false })
  expect(screen.getByText(either('practiceDisabledForStudents'))).toBeTruthy()
  expect(screen.getByText(either('practiceToggleOwnerOnly'))).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('owner/teacher switch it on, and the page is told to reload', async () => {
  apiRequest.mockResolvedValue({ enabled: true })
  const onChanged = vi.fn()
  show({ enabled: false, canToggle: true, onChanged })
  fireEvent.click(screen.getByRole('button', { name: either('practiceEnable') }))
  await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
  expect(apiRequest).toHaveBeenCalledWith('/api/sections/S1/practice', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
})

test('a refused switch says so instead of failing silently', async () => {
  apiRequest.mockRejectedValue(new ApiError('FORBIDDEN', 403))
  const onChanged = vi.fn()
  show({ enabled: false, canToggle: true, onChanged })
  fireEvent.click(screen.getByRole('button', { name: either('practiceEnable') }))
  await screen.findByText(either('practiceToggleForbidden'))
  expect(onChanged).not.toHaveBeenCalled()
})
