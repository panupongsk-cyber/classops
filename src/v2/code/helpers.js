import { ApiError } from '../auth/api.js'

const ERROR_KEYS = {
  CODE_RUNNER_NOT_CONFIGURED: 'codeError_RUNNER_NOT_CONFIGURED',
  CODE_RUNNER_UNAVAILABLE: 'codeError_RUNNER_UNAVAILABLE',
  CODE_RUNNER_BUSY: 'codeError_RUNNER_BUSY',
  CODE_EXERCISE_NOT_OPEN: 'codeError_NOT_OPEN',
  RATE_LIMITED: 'codeError_RATE_LIMITED',
  INVALID_REQUEST: 'codeError_INVALID_REQUEST',
}

/** A friendly message for an API error code (or ApiError), never a raw key. */
export function codeErrorText(t, error) {
  const code = error instanceof ApiError ? error.code : error
  return t(ERROR_KEYS[code] ?? 'genericError')
}

export const INDENT = '    '

/** Tab in the editor: insert four spaces at the selection instead of moving focus. */
export function insertIndent(value, start, end) {
  return { value: value.slice(0, start) + INDENT + value.slice(end), cursor: start + INDENT.length }
}

export const STATUS_KEYS = { draft: 'codeStatus_draft', open: 'codeStatus_open', closed: 'codeStatus_closed' }

export function emptyTest() {
  return { name: '', stdin: '', expected_stdout: '' }
}

/** Form tests to the API shape: drop an empty optional name. */
export function toPayloadTests(tests) {
  return tests.map(({ name, stdin, expected_stdout }) => (name.trim() ? { name: name.trim(), stdin, expected_stdout } : { stdin, expected_stdout }))
}

export function scoreText(passed, total) {
  return `${passed}/${total}`
}
