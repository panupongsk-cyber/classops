import { apiRequest } from '../auth/api.js'

export function listMySections() {
  return apiRequest('/api/me/sections')
}

export function createCourse(payload) {
  return apiRequest('/api/courses', { method: 'POST', body: JSON.stringify(payload) })
}

export function addSection(courseId, payload) {
  return apiRequest(`/api/courses/${courseId}/sections`, { method: 'POST', body: JSON.stringify(payload) })
}

export function joinSection(code, studentId) {
  const body = studentId ? { code, studentId } : { code }
  return apiRequest('/api/sections/join', { method: 'POST', body: JSON.stringify(body) })
}

export function getMyStudentId(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/me/student-id`)
}

export function setMyStudentId(sectionId, studentId) {
  return apiRequest(`/api/sections/${sectionId}/me/student-id`, { method: 'PUT', body: JSON.stringify({ studentId }) })
}

export function getSection(sectionId) {
  return apiRequest(`/api/sections/${sectionId}`)
}

export function getCourse(courseId) {
  return apiRequest(`/api/courses/${courseId}`)
}

export function regenerateJoinCode(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/join-code/regenerate`, { method: 'POST' })
}

export function listMemberships(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/memberships`)
}

export function inviteMember(sectionId, email, role) {
  return apiRequest(`/api/sections/${sectionId}/memberships`, {
    method: 'POST',
    body: JSON.stringify({ email, roles: [role] }),
  })
}

export function removeMember(sectionId, userId, roles) {
  return apiRequest(`/api/sections/${sectionId}/memberships/${userId}`, {
    method: 'DELETE',
    body: JSON.stringify({ roles }),
  })
}

// Roster import (PS-TASK-20260925-744). The file travels as base64; the server decodes it
// (UTF-8, or the registrar's TIS-620) and runs the same plan for preview and import.
export function previewRosterImport(sectionId, payload) {
  return apiRequest(`/api/sections/${sectionId}/roster-import/preview`, { method: 'POST', body: JSON.stringify(payload) })
}

export function applyRosterImport(sectionId, payload) {
  return apiRequest(`/api/sections/${sectionId}/roster-import`, { method: 'POST', body: JSON.stringify(payload) })
}

export function listRosterPending(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/roster-pending`)
}

export function cancelRosterPending(sectionId, entryId) {
  return apiRequest(`/api/sections/${sectionId}/roster-pending/${entryId}`, { method: 'DELETE' })
}
