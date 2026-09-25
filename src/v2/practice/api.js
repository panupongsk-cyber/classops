import { apiRequest } from '../auth/api.js'

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
