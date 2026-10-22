// The real FeedPage, PostCard and useFeedPolling with mocked API modules: how open and closed
// comment lists, and a lost session, react to polled feed changes (#2439).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as api from './api.js'
import FeedPage from './FeedPage.jsx'

vi.mock('./api.js', () => ({
  getFeed: vi.fn(), getFeedVersion: vi.fn(), getComments: vi.fn(), createComment: vi.fn(), deleteComment: vi.fn(),
  likePost: vi.fn(), unlikePost: vi.fn(), createPost: vi.fn(), deletePost: vi.fn(), uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(), attachmentUrl: vi.fn(() => '#'),
}))
vi.mock('../sections/api.js', () => ({
  listMemberships: vi.fn(async () => ({ memberships: [{ user_id: 'viewer', roles: ['student'] }] })),
}))
const auth = vi.hoisted(() => ({ user: { id: 'viewer', isPlatformAdmin: false } }))
vi.mock('../auth/V2AuthContext.jsx', () => ({ useV2Auth: () => auth }))
vi.mock('../i18n/I18nContext.jsx', () => ({ useI18n: () => ({ t: (k) => k }) }))
vi.mock('react-router-dom', () => ({ useParams: () => ({ sectionId: 'S1' }), Link: ({ children }) => children }))

const post = (commentCount, lastCommentAt) => ({
  id: 'A', body: 'Question 1?', link_url: null, created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z',
  author_user_id: 'teacher', author_email: null, author_display_name: 'Teacher', like_count: 0, liked_by_me: false,
  comment_count: commentCount, last_comment_at: lastCommentAt, attachments: [],
})
const comment = (id, body) => ({ id, post_id: 'A', author_user_id: 'other', author_display_name: 'Classmate', body, created_at: '2026-10-22T10:01:00Z' })

let server
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  server = { version: 'v1', posts: [post(2, 't2')], comments: [comment('c1', 'Answer is 12'), comment('c2', 'Nice')] }
  api.getFeed.mockImplementation(async () => ({ posts: server.posts, version: server.version }))
  api.getFeedVersion.mockImplementation(async () => ({ version: server.version }))
  api.getComments.mockImplementation(async () => ({ comments: server.comments }))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
const click = async (el) => { await act(async () => { fireEvent.click(el) }); await flush() }
const commentsButton = () => screen.getByText(/^commentsCta/)

test('an open list follows a delete-and-repost that keeps the comment count', async () => {
  render(<FeedPage />)
  await flush()
  await click(commentsButton())
  expect(screen.getByText(/Answer is 12/)).toBeTruthy()
  server = { version: 'v2', posts: [post(2, 't3')], comments: [comment('c2', 'Nice'), comment('c3', 'Answer is 21')] }
  await poll()
  await flush()
  expect(screen.queryByText(/Answer is 12/)).toBeNull()
  expect(screen.getByText(/Answer is 21/)).toBeTruthy()
})

test('a closed list refetches on reopen after a poll changed it', async () => {
  render(<FeedPage />)
  await flush()
  await click(commentsButton())
  await click(commentsButton())
  server = { version: 'v2', posts: [post(3, 't3')], comments: [comment('c1', 'Answer is 12'), comment('c2', 'Nice'), comment('c3', 'Third')] }
  await poll()
  await flush()
  await click(commentsButton())
  expect(screen.getByText(/Third/)).toBeTruthy()
})

test('a comment being typed survives a poll that refreshes the feed', async () => {
  render(<FeedPage />)
  await flush()
  await click(commentsButton())
  const input = screen.getByPlaceholderText('commentPlaceholder')
  fireEvent.change(input, { target: { value: 'half-written answer' } })
  server = { version: 'v2', posts: [post(3, 't3')], comments: [...server.comments, comment('c3', 'Third')] }
  await poll()
  await flush()
  expect(screen.getByText(/Third/)).toBeTruthy()
  expect(screen.getByPlaceholderText('commentPlaceholder').value).toBe('half-written answer')
})

test('losing access mid-session shows the forbidden state instead of a frozen feed', async () => {
  render(<FeedPage />)
  await flush()
  const forbidden = Object.assign(new Error('FORBIDDEN'), { status: 403 })
  api.getFeedVersion.mockRejectedValue(forbidden)
  const { ApiError } = await vi.importActual('../auth/api.js')
  api.getFeed.mockRejectedValue(new ApiError('FORBIDDEN', 403))
  await poll()
  await flush()
  expect(screen.getByText('forbiddenHeading')).toBeTruthy()
})
