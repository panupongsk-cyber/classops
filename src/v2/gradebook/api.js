import { apiRequest, apiUrl } from '../auth/api.js'

export function listCategories(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/categories`)
}

export function createCategory(sectionId, name, weight) {
  return apiRequest(`/api/sections/${sectionId}/categories`, {
    method: 'POST',
    body: JSON.stringify({ name, weight }),
  })
}

export function deleteCategory(categoryId) {
  return apiRequest(`/api/categories/${categoryId}`, { method: 'DELETE' })
}

export function listAssignments(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/assignments`)
}

export function createAssignment(categoryId, name, maxPoints) {
  return apiRequest(`/api/categories/${categoryId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ name, maxPoints }),
  })
}

export function deleteAssignment(assignmentId) {
  return apiRequest(`/api/assignments/${assignmentId}`, { method: 'DELETE' })
}

export function getAssignmentScores(assignmentId) {
  return apiRequest(`/api/assignments/${assignmentId}/scores`)
}

export function bulkSetScores(assignmentId, scores) {
  return apiRequest(`/api/assignments/${assignmentId}/scores/bulk`, {
    method: 'POST',
    body: JSON.stringify({ scores }),
  })
}

export function getGradebook(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/gradebook`)
}

// The export endpoint returns a raw text/csv body, not JSON -- bypasses apiRequest's JSON parsing
// and triggers a real browser download via a Blob object URL (a real deployed web app, not an
// Artifact sandbox, so a plain download link is the normal, correct approach here).
export async function downloadGradebookCsv(sectionId, filename) {
  const response = await fetch(apiUrl(`/api/sections/${sectionId}/gradebook/export`), {
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
