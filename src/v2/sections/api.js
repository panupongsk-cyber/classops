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

export function joinSection(code) {
  return apiRequest('/api/sections/join', { method: 'POST', body: JSON.stringify({ code }) })
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
