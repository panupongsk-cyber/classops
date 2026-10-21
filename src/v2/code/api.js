import { apiRequest } from '../auth/api.js'

// Python code exercises. The server pins the language and runs code on its own runner; this
// client only sends source text.

export const listCodeExercises = (sectionId) => apiRequest(`/api/sections/${sectionId}/code-exercises`)
export const createCodeExercise = (sectionId, payload) =>
  apiRequest(`/api/sections/${sectionId}/code-exercises`, { method: 'POST', body: JSON.stringify(payload) })
export const getCodeExercise = (id) => apiRequest(`/api/code-exercises/${id}`)
export const updateCodeExercise = (id, payload) =>
  apiRequest(`/api/code-exercises/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const runCodeExercise = (id, code) =>
  apiRequest(`/api/code-exercises/${id}/run`, { method: 'POST', body: JSON.stringify({ code }) })
export const submitCodeExercise = (id, code) =>
  apiRequest(`/api/code-exercises/${id}/submissions`, { method: 'POST', body: JSON.stringify({ code }) })
export const listCodeSubmissions = (id) => apiRequest(`/api/code-exercises/${id}/submissions`)
