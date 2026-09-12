import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { listSessions } from './api.js'
import { closeSession, getCurrentCode, getCurrentEmoji, getRoster } from './api.js'

const POLL_MS = 8000

export default function SessionLivePage() {
  const { t } = useI18n()
  const { sectionId, sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession] = useState(undefined)
  const [display, setDisplay] = useState(null) // { code, expiresAt } or { emoji }
  const [roster, setRoster] = useState(null)
  const [status, setStatus] = useState('loading')
  const pollRef = useRef(null)

  const loadSession = useCallback(async () => {
    const result = await listSessions(sectionId)
    const found = result.sessions.find((s) => s.id === sessionId)
    setSession(found ?? null)
    return found
  }, [sectionId, sessionId])

  const loadDisplayAndRoster = useCallback(async (currentSession) => {
    const rosterResult = await getRoster(sessionId)
    setRoster(rosterResult.roster)
    if (currentSession?.opened_at && !currentSession?.closed_at) {
      if (currentSession.check_in_method === 'qr') {
        const codeResult = await getCurrentCode(sessionId)
        setDisplay({ code: codeResult.code })
      } else if (currentSession.check_in_method === 'emoji') {
        const emojiResult = await getCurrentEmoji(sessionId)
        setDisplay({ emoji: emojiResult.emoji })
      }
    }
  }, [sessionId])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const found = await loadSession()
      if (!found) { setStatus('error'); return }
      await loadDisplayAndRoster(found)
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [loadSession, loadDisplayAndRoster])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (status !== 'ok' || !session?.opened_at || session?.closed_at) return
    pollRef.current = setInterval(async () => {
      try {
        await loadDisplayAndRoster(session)
      } catch {
        // A transient poll failure just skips this tick; the next poll retries.
      }
    }, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [status, session, loadDisplayAndRoster])

  async function handleClose() {
    await closeSession(sessionId)
    navigate(`/v2/sections/${sectionId}/attendance`)
  }

  if (status === 'loading') return <div style={{ padding: 40 }}><LoadingRows /></div>
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <div style={{ padding: 40 }}><RetryableError onRetry={load} /></div>

  const isOpen = session.opened_at && !session.closed_at
  const checkedInCount = roster.filter((m) => m.checked_in_at).length

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px', fontFamily: "'Prompt','Inter',system-ui,sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 900, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Link to={`/v2/sections/${sectionId}/attendance`} style={{ color: '#94a3b8', fontSize: '.9rem' }}>{t('backToAttendance')}</Link>
        {isOpen && (
          <button
            type="button"
            onClick={handleClose}
            style={{ padding: '10px 20px', borderRadius: 10, border: 0, background: '#ef4444', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            {t('closeSessionCta')}
          </button>
        )}
      </div>

      {isOpen ? (
        <>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 600, margin: '0 0 24px' }}>{t('liveSessionHeading')}</h1>
          {display?.code && (
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <p style={{ color: '#94a3b8', marginBottom: 16 }}>{t('qrHeading')}</p>
              <div style={{ background: '#fff', padding: 24, borderRadius: 20, display: 'inline-block' }}>
                <QRCodeSVG value={`${window.location.origin}/v2/checkin?session=${sessionId}&code=${display.code}`} size={240} />
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '2.5rem', fontWeight: 700, letterSpacing: '.1em', marginTop: 20 }}>
                {display.code}
              </div>
            </div>
          )}
          {display?.emoji && (
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <p style={{ color: '#94a3b8', marginBottom: 16 }}>{t('emojiHeading')}</p>
              <div style={{ fontSize: '9rem', lineHeight: 1 }}>{display.emoji}</div>
            </div>
          )}
        </>
      ) : (
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: '0 0 24px' }}>{t('statusClosed')}</h1>
      )}

      <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>
        {t('rosterCheckedInCount', { checked: checkedInCount, total: roster.length })}
      </div>
      <div style={{ width: '100%', maxWidth: 500, background: 'rgba(255,255,255,.06)', borderRadius: 16, overflow: 'hidden' }}>
        {roster.map((member) => (
          <div key={member.user_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.08)', fontSize: '.9rem' }}>
            <span>{member.display_name}</span>
            <span style={{ color: member.checked_in_at ? '#34d399' : '#64748b' }}>
              {member.checked_in_at ? '✓' : t('notCheckedInYet')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
