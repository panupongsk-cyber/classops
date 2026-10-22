import { useCallback, useEffect, useRef, useState } from 'react'
import { useFeedPolling } from './useFeedPolling.js'
import { useParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { listMemberships } from '../sections/api.js'
import FileInput from '../components/FileInput.jsx'
import {
  attachmentUrl, createComment, createPost, deleteAttachment, deleteComment, deletePost, getComments, getFeed,
  likePost, unlikePost, uploadAttachment,
} from './api.js'
import { ACCEPT, MAX_ATTACHMENTS_PER_POST, attachmentProblem, formatBytes, isImage } from './attachments.js'

const MANAGER_ROLES = ['owner', 'teacher', 'ta']

export default function FeedPage() {
  const { t } = useI18n()
  const { user } = useV2Auth()
  const { sectionId } = useParams()

  const [posts, setPosts] = useState(null)
  const [version, setVersion] = useState(null)
  const [isManager, setIsManager] = useState(false)
  const [status, setStatus] = useState('loading')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [posting, setPosting] = useState(false)
  const [files, setFiles] = useState([]) // File objects chosen for the new post
  const [attachNotice, setAttachNotice] = useState(null) // { failed: [{ name, key }] } after a post

  // `silent` refreshes in place (polling, likes, attachments): the page stays mounted, so open
  // comment lists, drafts and the composer keep their state.
  // Only the latest load may apply: a slower, older response (a poll overtaken by a like, say)
  // must not overwrite a newer one.
  const loadSeq = useRef(0)
  const load = useCallback(async (options) => {
    const seq = ++loadSeq.current
    if (!options?.silent) setStatus('loading')
    try {
      const [feedResult, membershipsResult] = await Promise.all([
        getFeed(sectionId), listMemberships(sectionId),
      ])
      if (seq !== loadSeq.current) return
      setPosts(feedResult.posts)
      setVersion(feedResult.version)
      const mine = membershipsResult.memberships.find((m) => m.user_id === user?.id)
      setIsManager(Boolean(user?.isPlatformAdmin) || Boolean(mine?.roles.some((role) => MANAGER_ROLES.includes(role))))
      setStatus('ok')
    } catch (err) {
      if (seq !== loadSeq.current) return
      if (options?.silent) return // keep what is on screen; the next poll retries
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [sectionId, user])

  useEffect(() => { load() }, [load])
  const refresh = useCallback(() => load({ silent: true }), [load])
  // Access lost mid-session: a full load shows the forbidden or error state instead of a frozen feed.
  useFeedPolling(sectionId, version, refresh, { onLost: () => load() })

  function chooseFile(event) {
    const input = event.target
    const chosen = input.files?.[0]
    input.value = ''
    if (!chosen) return
    const problem = attachmentProblem(chosen)
    if (problem) {
      setAttachNotice({ failed: [{ name: chosen.name, key: problem }] })
      return
    }
    setAttachNotice(null)
    setFiles((current) => (current.length >= MAX_ATTACHMENTS_PER_POST ? current : [...current, chosen]))
  }

  async function handlePost(event) {
    event.preventDefault()
    setPosting(true)
    setAttachNotice(null)
    try {
      const { post } = await createPost(sectionId, body.trim(), linkUrl.trim() || undefined)
      // One at a time: a refused file is reported and the rest still go up.
      const failed = []
      for (const file of files) {
        try {
          await uploadAttachment(post.id, file)
        } catch (err) {
          failed.push({ name: file.name, key: attachErrorKey(err) })
        }
      }
      setBody('')
      setLinkUrl('')
      setFiles([])
      if (failed.length) setAttachNotice({ failed })
      await refresh()
    } finally {
      setPosting(false)
    }
  }

  async function handleDeletePost(postId) {
    if (!window.confirm(t('deletePostConfirm'))) return
    await deletePost(postId)
    await refresh()
  }

  async function handleToggleLike(post) {
    if (post.liked_by_me) await unlikePost(post.id)
    else await likePost(post.id)
    await refresh()
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            {files.length < MAX_ATTACHMENTS_PER_POST && (
              <FileInput accept={ACCEPT} onChange={chooseFile} disabled={posting} label={t('attachChoose')} fileName="" />
            )}
            <span className="v2-field-hint" style={{ margin: 0 }}>{t('attachHint')}</span>
          </div>
          {files.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '.85rem' }}>
              {files.map((file, index) => (
                <li key={`${file.name}:${index}`}>
                  {file.name} <span className="is-muted">({formatBytes(file.size)})</span>{' '}
                  <button type="button" className="v2-link-action" disabled={posting} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-error-fg)', padding: 0 }} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>{t('remove')}</button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {attachNotice && (
        <div className="v2-notice v2-notice-error" style={{ marginBottom: 16 }}>
          {attachNotice.failed.map((f) => <div key={f.name}>{t('attachFailed', { name: f.name, reason: t(f.key) })}</div>)}
        </div>
      )}

      {posts.length === 0 && <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.88rem' }}>{t('noPosts')}</p>}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} isManager={isManager} onLike={() => handleToggleLike(post)} onDelete={() => handleDeletePost(post.id)} onChanged={refresh} t={t} currentUserId={user?.id} />
      ))}
    </div>
  )
}

// A known server error code has its own message; anything else gets the generic one.
function attachErrorKey(err) {
  const known = ['UNSUPPORTED_FILE_TYPE', 'EMPTY_FILE', 'TOO_MANY_ATTACHMENTS', 'INVALID_FILE_NAME']
  if (err instanceof ApiError && known.includes(err.code)) return `attachError_${err.code}`
  if (err instanceof ApiError && err.status === 413) return 'attachError_FILE_TOO_LARGE'
  return 'genericError'
}

function Attachments({ post, isManager, onChanged, t }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const attachments = post.attachments ?? []
  const images = attachments.filter((a) => isImage(a.contentType))
  const others = attachments.filter((a) => !isImage(a.contentType))

  async function add(event) {
    const input = event.target
    const chosen = input.files?.[0]
    input.value = ''
    if (!chosen) return
    const problem = attachmentProblem(chosen)
    if (problem) { setError(t('attachFailed', { name: chosen.name, reason: t(problem) })); return }
    setBusy(true)
    setError(null)
    try {
      await uploadAttachment(post.id, chosen)
      await onChanged()
    } catch (err) {
      setError(t('attachFailed', { name: chosen.name, reason: t(attachErrorKey(err)) }))
    } finally {
      setBusy(false)
    }
  }

  async function remove(attachment) {
    if (!window.confirm(t('attachRemoveConfirm', { name: attachment.fileName }))) return
    setError(null)
    try {
      await deleteAttachment(attachment.id)
    } catch (err) {
      // Already gone is what was asked for; anything else is reported.
      if (!(err instanceof ApiError && err.code === 'ATTACHMENT_NOT_FOUND')) setError(t('genericError'))
    } finally {
      await onChanged()
    }
  }

  const removeButton = (attachment) => isManager && (
    <button type="button" onClick={() => remove(attachment)} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-error-fg)', fontSize: '.75rem' }}>{t('remove')}</button>
  )

  if (attachments.length === 0 && !isManager) return null
  return (
    <div style={{ marginBottom: 10 }}>
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          {images.map((a) => (
            <figure key={a.id} style={{ margin: 0, maxWidth: '100%' }}>
              <a href={attachmentUrl(a.id)} download={a.fileName}>
                <img src={attachmentUrl(a.id, { inline: true })} alt={a.fileName} loading="lazy" style={{ display: 'block', maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid var(--v2-border)' }} />
              </a>
              <figcaption style={{ fontSize: '.75rem', color: 'var(--v2-ink-muted)' }}>{a.fileName} · {formatBytes(a.sizeBytes)} {removeButton(a)}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {others.map((a) => (
        <div key={a.id} style={{ fontSize: '.85rem', padding: '2px 0' }}>
          📎 <a href={attachmentUrl(a.id)} download={a.fileName}>{a.fileName}</a> <span className="is-muted">({formatBytes(a.sizeBytes)})</span> {removeButton(a)}
        </div>
      ))}
      {isManager && attachments.length < MAX_ATTACHMENTS_PER_POST && (
        <div style={{ marginTop: 6 }}>
          <FileInput accept={ACCEPT} onChange={add} disabled={busy} label={t('attachAdd')} fileName="" />
        </div>
      )}
      {error && <p className="v2-field-error" style={{ margin: '4px 0 0' }}>{error}</p>}
    </div>
  )
}

function PostCard({ post, isManager, onLike, onDelete, onChanged, t, currentUserId }) {
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState(null)
  const [commentBody, setCommentBody] = useState('')

  const commentsSeq = useRef(0)
  async function loadComments() {
    const seq = ++commentsSeq.current
    const result = await getComments(post.id)
    if (seq === commentsSeq.current) setComments(result.comments)
  }

  // When a refresh shows this post's comments changed (count, or the newest comment -- a
  // delete-and-repost keeps the count), an open list reloads and a closed one forgets its cache so
  // the next open fetches (#2439). The comment being typed lives in its own state and is untouched.
  const commentsMarker = `${post.comment_count}|${post.last_comment_at ?? ''}`
  const firstMarker = useRef(true)
  useEffect(() => {
    if (firstMarker.current) { firstMarker.current = false; return }
    if (showComments) loadComments().catch(() => {})
    else setComments(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsMarker])

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
      <Attachments post={post} isManager={isManager} onChanged={onChanged} t={t} />
      <div style={{ display: 'flex', gap: 16, fontSize: '.82rem', color: 'var(--v2-ink-muted)' }}>
        <button type="button" className="v2-link-action" onClick={onLike} style={{ background: 'none', border: 0, cursor: 'pointer', color: post.liked_by_me ? 'var(--v2-primary)' : 'var(--v2-ink-muted)', fontWeight: post.liked_by_me ? 600 : 400, padding: 0 }}>
          {post.liked_by_me ? t('unlikeCta') : t('likeCta')} ({post.like_count})
        </button>
        <button type="button" className="v2-link-action" onClick={toggleComments} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-ink-muted)', padding: 0 }}>
          {t('commentsCta')} ({post.comment_count})
        </button>
        {isManager && <button type="button" className="v2-link-action" onClick={onDelete} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--v2-error-fg)', padding: 0, marginLeft: 'auto' }}>{t('remove')}</button>}
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
