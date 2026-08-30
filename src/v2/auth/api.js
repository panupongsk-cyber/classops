const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export function apiUrl(path) {
  return `${apiBaseUrl}${path}`
}

export class ApiError extends Error {
  constructor(code, status, fields = []) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.fields = fields
  }
}

export async function apiRequest(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (response.status === 204) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(body.error || 'REQUEST_FAILED', response.status, body.fields)
  }
  return body
}
