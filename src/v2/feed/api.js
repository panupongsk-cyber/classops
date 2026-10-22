import { apiRequest, apiUrl } from '../auth/api.js'

export function getFeed(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/feed`)
}

export function getFeedVersion(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/feed/version`)
}

export function createPost(sectionId, body, linkUrl) {
  const payload = { body }
  if (linkUrl) payload.linkUrl = linkUrl
  return apiRequest(`/api/sections/${sectionId}/posts`, { method: 'POST', body: JSON.stringify(payload) })
}

export function deletePost(postId) {
  return apiRequest(`/api/posts/${postId}`, { method: 'DELETE' })
}

export function getComments(postId) {
  return apiRequest(`/api/posts/${postId}/comments`)
}

export function createComment(postId, body) {
  return apiRequest(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
}

export function deleteComment(commentId) {
  return apiRequest(`/api/comments/${commentId}`, { method: 'DELETE' })
}

export function likePost(postId) {
  return apiRequest(`/api/posts/${postId}/like`, { method: 'POST' })
}

export function unlikePost(postId) {
  return apiRequest(`/api/posts/${postId}/like`, { method: 'DELETE' })
}

// Attachments (#2438): the file goes up as raw bytes with its name in the query string.
export function uploadAttachment(postId, file) {
  return apiRequest(`/api/posts/${postId}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}

export function deleteAttachment(attachmentId) {
  return apiRequest(`/api/attachments/${attachmentId}`, { method: 'DELETE' })
}

export function attachmentUrl(attachmentId, { inline = false } = {}) {
  return apiUrl(`/api/attachments/${attachmentId}${inline ? '?inline=1' : ''}`)
}
