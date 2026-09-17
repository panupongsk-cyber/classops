import { apiRequest } from '../auth/api.js'

export function getAdminOverview() {
  return apiRequest('/api/admin/overview')
}

export function listAdminUsers({ search = '', role = 'all', page = 1, limit = 20 } = {}) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (role && role !== 'all') params.set('role', role)
  if (page > 1) params.set('page', String(page))
  if (limit !== 20) params.set('limit', String(limit))
  const qs = params.toString()
  return apiRequest(`/api/admin/users${qs ? `?${qs}` : ''}`)
}

export function updateUserRole(userId, isPlatformAdmin) {
  return apiRequest(`/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ isPlatformAdmin }),
  })
}

export function updateUserStatus(userId, status) {
  return apiRequest(`/api/admin/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function listAdminCourses() {
  return apiRequest('/api/admin/courses')
}

export function reassignSectionOwner(sectionId, newOwnerUserId) {
  return apiRequest(`/api/admin/sections/${sectionId}/owner`, {
    method: 'PATCH',
    body: JSON.stringify({ newOwnerUserId }),
  })
}

export function resetSectionJoinCode(sectionId) {
  return apiRequest(`/api/admin/sections/${sectionId}/reset-join-code`, {
    method: 'POST',
  })
}

export function listAdminLiveSessions() {
  return apiRequest('/api/admin/sessions/live')
}

export function closeAdminSession(sessionId) {
  return apiRequest(`/api/admin/sessions/${sessionId}/close`, {
    method: 'POST',
  })
}

export function listAdminAuditLogs({ search = '', category = 'all', page = 1, limit = 25 } = {}) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (category && category !== 'all') params.set('category', category)
  if (page > 1) params.set('page', String(page))
  if (limit !== 25) params.set('limit', String(limit))
  const qs = params.toString()
  return apiRequest(`/api/admin/audit-logs${qs ? `?${qs}` : ''}`)
}
