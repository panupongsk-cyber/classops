import { apiRequest, apiUrl } from '../auth/api.js'

// Learning activities (server-scored games). Items arrive already projected by the server:
// options and rows are opaque per-attempt tokens, and answers go back as those tokens -- this
// client never sees answer keys, option ids, or the attempt seed.

export function listPackages() {
  return apiRequest('/api/activity-packages')
}

export function listActivities(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/activities`)
}

export function attachActivity(sectionId, payload) {
  return apiRequest(`/api/sections/${sectionId}/activities`, { method: 'POST', body: JSON.stringify(payload) })
}

export function updateActivity(activityId, payload) {
  return apiRequest(`/api/section-activities/${activityId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function startAttempt(activityId, lang) {
  return apiRequest(`/api/section-activities/${activityId}/attempts`, { method: 'POST', body: JSON.stringify({ lang }) })
}

export function submitResponse(attemptId, itemKey, answer) {
  return apiRequest(`/api/activity-attempts/${attemptId}/responses`, {
    method: 'POST',
    body: JSON.stringify({ itemKey, answer }),
  })
}

export function finishAttempt(attemptId) {
  return apiRequest(`/api/activity-attempts/${attemptId}/finish`, { method: 'POST' })
}

export function getAttempt(attemptId) {
  return apiRequest(`/api/activity-attempts/${attemptId}`)
}

export function getEvidence(activityId) {
  return apiRequest(`/api/section-activities/${activityId}/evidence`)
}

export function getGradebookSync(activityId) {
  return apiRequest(`/api/section-activities/${activityId}/gradebook-sync`)
}

export function applyGradebookSync(activityId, overwriteUserIds) {
  return apiRequest(`/api/section-activities/${activityId}/gradebook-sync`, {
    method: 'POST',
    body: JSON.stringify({ overwriteUserIds }),
  })
}

// Raw text/csv, not JSON -- same Blob download pattern as the gradebook export.
export async function downloadEvidenceCsv(activityId, filename) {
  const response = await fetch(apiUrl(`/api/section-activities/${activityId}/evidence/export`), {
    credentials: 'include',
  })
  if (!response.ok) throw new Error('EXPORT_FAILED')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** A package/activity title is a {th?, en?} object; show the UI language, else any. */
export function localized(text, lang) {
  if (!text) return ''
  return text[lang] ?? text.th ?? text.en ?? ''
}

export function percent(ratio) {
  return ratio === null || ratio === undefined ? '—' : `${Math.round(ratio * 1000) / 10}%`
}
