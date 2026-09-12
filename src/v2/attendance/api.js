import { apiRequest } from '../auth/api.js'

export function setTermDates(sectionId, termStartDate, termEndDate) {
  return apiRequest(`/api/sections/${sectionId}/term-dates`, {
    method: 'PATCH',
    body: JSON.stringify({ termStartDate, termEndDate }),
  })
}

export function listSchedulePatterns(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/schedule-patterns`)
}

export function addSchedulePattern(sectionId, dayOfWeek, startTime, endTime) {
  return apiRequest(`/api/sections/${sectionId}/schedule-patterns`, {
    method: 'POST',
    body: JSON.stringify({ dayOfWeek, startTime, endTime }),
  })
}

export function generateSessions(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/generate-sessions`, { method: 'POST', body: JSON.stringify({}) })
}

export function createSession(sectionId, scheduledStart, scheduledEnd) {
  return apiRequest(`/api/sections/${sectionId}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ scheduledStart, scheduledEnd }),
  })
}

export function listSessions(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/sessions`)
}

export function getOpenSession(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/sessions/open`)
}

export function openSession(sessionId, checkInMethod) {
  return apiRequest(`/api/sessions/${sessionId}/open`, {
    method: 'POST',
    body: JSON.stringify({ checkInMethod }),
  })
}

export function closeSession(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/close`, { method: 'POST' })
}

export function getCurrentCode(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/current-code`)
}

export function getCurrentEmoji(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/current-emoji`)
}

export function getRoster(sessionId) {
  return apiRequest(`/api/sessions/${sessionId}/roster`)
}

export function checkIn(sessionId, value) {
  return apiRequest(`/api/sessions/${sessionId}/check-in`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })
}

// Fixed at build time, mirrored exactly from server/src/routes/sessions.ts's EMOJI_PALETTE so the
// student's tappable options (including decoys) match what the server will actually accept.
export const EMOJI_PALETTE = [
  '🐶', '🐱', '🦊', '🐼', '🐵', '🐸', '🐧', '🦁',
  '🐷', '🐮', '🐨', '🦄', '🐙', '🦋', '🐝', '🐢',
]
