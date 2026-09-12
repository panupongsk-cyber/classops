import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { listMemberships } from '../sections/api.js'
import {
  createComment, createPost, deleteComment, deletePost, getComments, getFeed, likePost, unlikePost,
} from './api.js'

const MANAGER_ROLES = ['owner', 'teacher', 'ta']

export default function FeedPage() {
  const { t } = useI18n()
  const { user } = useV2Auth()
  const { sectionId } = useParams()

  const [posts, setPosts] = useState(null)
  const [isManager, setIsManager] = useState(false)
  const [status, setStatus] = useState('loading')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [feedResult, membershipsResult] = await Promise.all([
        getFeed(sectionId), listMemberships(sectionId),
      ])
      setPosts(feedResult.posts)
      const mine = membershipsResult.memberships.find((m) => m.user_id === user?.id)
      setIsManager(Boolean(user?.isPlatformAdmin) || Boolean(mine?.roles.some((role) => MANAGER_ROLES.includes(role))))
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [sectionId, user])

  useEffect(() => { load() }, [load])

  async function handlePost(event) {
    event.preventDefault()
    setPosting(true)
    try {
      await createPost(sectionId, body.trim(), linkUrl.trim() || undefined)
      setBody('')
      setLinkUrl('')
      await load()
    } finally {
      setPosting(false)
    }
  }

  async function handleDeletePost(postId) {
    if (!window.confirm(t('deletePostConfirm'))) return
    await deletePost(postId)
    await load()
  }

  async function handleToggleLike(post) {
    if (post.liked_by_me) await unlikePost(post.id)
    else await likePost(post.id)
    await load()
  }

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  return (
    <div className="v2-content-narrow">
      <h1 className="v2-h1">{t('feedHeading')}</h1>

      {isManager && (
        <form onSubmit={handlePost} className="v2-card" style={{ marginBottom: 20 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('newPostPlaceholder')}
            rows={3}
            required
            style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--v2-border-strong)', borderRadius: 10, fontFamily: 'inherit', fontSize: '.9rem', marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder={t('newPostLinkPlaceholder')}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--v2-border-strong)', borderRadius: 8, fontSize: '.85rem' }}
            />
            <button type="submit" className="v2-btn v2-btn-primary" disabled={posting}>{t('postCta')}</button>
          </div>
        </form>
      )}

      {posts.length === 0 && <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.88rem' }}>{t('noPosts')}</p>}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} isManager={isManager} onLike={() => handleToggleLike(post)} onDelete={() => handleDeletePost(post.id)} t={t} currentUserId={user?.id} />
      ))}
    </div>
  )
}

function PostCard({ post, isManager, onLike, onDelete, t, currentUserId }) {
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState(null)
  const [commentBody, setCommentBody] = useState('')

  async function loadComments() {
    const result = await getComments(post.id)
    setComments(result.comments)
  }

  async function toggleComments() {
    if (!showComments && comments === null) await loadComments()
    setShowComments((prev) => !prev)
  }

  async function handleAddComment(event) {
    event.preventDefault()
    await createComment(post.id, commentBody.trim())
    setCommentBody('')
    await loadComments()
  }

  async function handleDeleteComment(commentId) {
    if (!window.confirm(t('deleteCommentConfirm'))) return
    await deleteComment(commentId)
    await loadComments()
  }

  return (
    <div className="v2-card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{post.author_display_name}</span>
        <span style={{ fontSize: '.75rem', color: 'var(--v2-ink-faint)' }}>{new Date(post.created_at).toLocaleString()}</span>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: '.92rem', whiteSpace: 'pre-wrap' }}>{post.body}</p>
      {post.link_url && <a href={post.link_url} target="_blank" rel="noreferrer" style={{ fontSize: '.85rem', display: 'block', marginBottom: 10 }}>{post.link_url}</a>}
      <div style={{ display: 'flex', gap: 16, fontSize: '.82rem', color: 'var(--v2-ink-muted)' }}>
        <button type="button" onClick={onLike} style={{ background: 'none', border: 0, cursor: 'pointer', color: post.liked_by_me ? 'var(--v2-primary)' : 'var(--v2-ink-muted)', fontWeight: post.liked_by_me ? 600 : 400, padding: 0 }}>
          {post.liked_by_me ? t('unlikeCta') : t('likeCta')} ({post.like_count})
        </button>
        <button type="button" onClick={toggleComments} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-ink-muted)', padding: 0 }}>
          {t('commentsCta')} ({post.comment_count})
        </button>
        {isManager && <button type="button" onClick={onDelete} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-error-fg)', padding: 0, marginLeft: 'auto' }}>{t('remove')}</button>}
      </div>

      {showComments && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--v2-border)' }}>
          {comments?.length === 0 && <p style={{ fontSize: '.8rem', color: 'var(--v2-ink-faint)' }}>{t('noComments')}</p>}
          {comments?.map((comment) => (
            <div key={comment.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '.85rem', padding: '6px 0', borderBottom: '1px solid var(--v2-border)' }}>
              <div><strong>{comment.author_display_name}</strong>: {comment.body}</div>
              {(isManager || comment.author_user_id === currentUserId) && (
                <button type="button" onClick={() => handleDeleteComment(comment.id)} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-error-fg)', fontSize: '.75rem' }}>{t('remove')}</button>
              )}
            </div>
          ))}
          <form onSubmit={handleAddComment} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder={t('commentPlaceholder')} required style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--v2-border-strong)', borderRadius: 8, fontSize: '.85rem' }} />
            <button type="submit" className="v2-btn v2-btn-secondary" style={{ padding: '6px 14px', fontSize: '.8rem' }}>{t('postCommentCta')}</button>
          </form>
        </div>
      )}
    </div>
  )
}
