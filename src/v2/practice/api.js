import { apiRequest, apiUrl } from '../auth/api.js'

// Exam practice (PS-TASK-20260925-755). Answer keys arrive only after an answer, or in browse mode.
const base = (sectionId) => `/api/sections/${sectionId}/practice`

export const listExams = (sectionId) => apiRequest(`${base(sectionId)}/exams`)
export const setPracticeEnabled = (sectionId, enabled) =>
  apiRequest(base(sectionId), { method: 'PATCH', body: JSON.stringify({ enabled }) })
export function browseQuestions(sectionId, examId, { category, offset = 0, limit = 10 } = {}) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (category) params.set('category', category)
  return apiRequest(`${base(sectionId)}/exams/${examId}/questions?${params}`)
}
export const startAttempt = (sectionId, payload) =>
  apiRequest(`${base(sectionId)}/attempts`, { method: 'POST', body: JSON.stringify(payload) })
export const getAttempt = (sectionId, attemptId) => apiRequest(`${base(sectionId)}/attempts/${attemptId}`)
export const answerQuestion = (sectionId, attemptId, questionId, selected) =>
  apiRequest(`${base(sectionId)}/attempts/${attemptId}/answers`, { method: 'POST', body: JSON.stringify({ questionId, selected }) })
// Mock exam (PS-TASK-20260925-767): answers go through answerQuestion (null clears); flags here.
export const setFlag = (sectionId, attemptId, questionId, flagged) =>
  apiRequest(`${base(sectionId)}/attempts/${attemptId}/flags`, { method: 'POST', body: JSON.stringify({ questionId, flagged }) })
export const finishAttempt = (sectionId, attemptId) =>
  apiRequest(`${base(sectionId)}/attempts/${attemptId}/finish`, { method: 'POST', body: '{}' })
export const listAttempts = (sectionId) => apiRequest(`${base(sectionId)}/attempts`)

// Practice assignments (PS-TASK-20260926-785).
export const listAssignments = (sectionId) => apiRequest(`${base(sectionId)}/assignments`)
export const createAssignment = (sectionId, payload) =>
  apiRequest(`${base(sectionId)}/assignments`, { method: 'POST', body: JSON.stringify(payload) })
export const updateAssignment = (assignmentId, payload) =>
  apiRequest(`/api/practice-assignments/${assignmentId}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const deleteAssignment = (assignmentId) => apiRequest(`/api/practice-assignments/${assignmentId}`, { method: 'DELETE' })
export const startAssignment = (assignmentId, lang) =>
  apiRequest(`/api/practice-assignments/${assignmentId}/attempts`, { method: 'POST', body: JSON.stringify({ lang }) })

// Assignment results, CSV, and gradebook sync (PS-TASK-20260926-789; staff only).
export const getAssignmentResults = (assignmentId) => apiRequest(`/api/practice-assignments/${assignmentId}/results`)
export const getAssignmentSync = (assignmentId) => apiRequest(`/api/practice-assignments/${assignmentId}/gradebook-sync`)
export const applyAssignmentSync = (assignmentId, overwriteUserIds) =>
  apiRequest(`/api/practice-assignments/${assignmentId}/gradebook-sync`, { method: 'POST', body: JSON.stringify({ overwriteUserIds }) })
// Raw text/csv, not JSON: the same Blob download pattern as the activity evidence export.
export async function downloadAssignmentCsv(assignmentId, filename) {
  const response = await fetch(apiUrl(`/api/practice-assignments/${assignmentId}/results/export`), { credentials: 'include' })
  if (!response.ok) throw new Error('EXPORT_FAILED')
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Personal progress (PS-TASK-20260925-770).
export const listBookmarks = (sectionId) => apiRequest(`${base(sectionId)}/bookmarks`)
export const setBookmark = (sectionId, questionId, bookmarked) =>
  apiRequest(`${base(sectionId)}/bookmarks`, { method: 'POST', body: JSON.stringify({ questionId, bookmarked }) })
export const getPracticeStats = (sectionId) => apiRequest(`${base(sectionId)}/stats`)
export function getMostMissed(sectionId, { examId, limit = 10 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (examId) params.set('examId', examId)
  return apiRequest(`${base(sectionId)}/most-missed?${params}`)
}

/** Question text in the chosen language, falling back to English (the source language). */
export const pick = (text, lang) => (lang === 'th' && text?.th ? text.th : text?.en ?? '')
