import { apiRequest } from '../auth/api.js'

export function getFeed(sectionId) {
  return apiRequest(`/api/sections/${sectionId}/feed`)
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
