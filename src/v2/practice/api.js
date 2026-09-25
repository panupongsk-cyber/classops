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
export const finishAttempt = (sectionId, attemptId) =>
  apiRequest(`${base(sectionId)}/attempts/${attemptId}/finish`, { method: 'POST', body: '{}' })
export const listAttempts = (sectionId) => apiRequest(`${base(sectionId)}/attempts`)

/** Question text in the chosen language, falling back to English (the source language). */
export const pick = (text, lang) => (lang === 'th' && text?.th ? text.th : text?.en ?? '')
