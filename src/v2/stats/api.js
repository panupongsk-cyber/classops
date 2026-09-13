import { apiRequest } from '../auth/api.js'

export function getSectionStats(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/stats`)
}

export function getStudentStats(sectionId, userId) {
  return apiRequest(`/api/sections/${sectionId}/stats/students/${userId}`)
}
