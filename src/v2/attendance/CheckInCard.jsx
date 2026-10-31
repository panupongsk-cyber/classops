import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import FaceScanner from '../face/FaceScanner.jsx'
import { EMOJI_PALETTE, checkIn, checkInFace, getFaceChallenge, getOpenSession } from './api.js'

const POLL_MS = 10000

export default function CheckInCard({ sectionId }) {
  const { t } = useI18n()
  const [openSession, setOpenSession] = useState(undefined) // undefined = loading, null = none open
  const [code, setCode] = useState('')
  const [result, setResult] = useState(null) // 'success' | 'failed' | 'already' | null
  const [submitting, setSubmitting] = useState(false)
  // Face method: a single-use nonce + liveness challenge, fetched per capture attempt.
  const [face, setFace] = useState(null) // { nonce, challenge, attempt }
  const [faceError, setFaceError] = useState(null) // 'notEnrolled' | 'mismatch' | 'nonce' | null

  const poll = useCallback(async () => {
    try {
      const response = await getOpenSession(sectionId)
      setOpenSession(response.session)
    } catch {
      setOpenSession(null)
    }
  }, [sectionId])

  useEffect(() => {
    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => clearInterval(interval)
  }, [poll])

  async function submitCheckIn(value) {
    setSubmitting(true)
    setResult(null)
    try {
      // The server treats an already-recorded check-in as an idempotent success (200), not an
      // error -- it never reports "you already checked in" as a distinct outcome.
      await checkIn(openSession.id, value)
      setResult('success')
    } catch {
      setResult('failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function startFaceCapture() {
    setFaceError(null)
    setResult(null)
    try {
      const challenge = await getFaceChallenge(openSession.id)
      setFace({ nonce: challenge.nonce, challenge: challenge.challenge, attempt: (face?.attempt ?? 0) + 1 })
    } catch {
      setResult('failed')
    }
  }

  async function handleFaceCaptured(descriptor) {
    setSubmitting(true)
    try {
      await checkInFace(openSession.id, face.nonce, descriptor)
      setResult('success')
    } catch (err) {
      if (err.code === 'NOT_ENROLLED') setFaceError('notEnrolled')
      else if (err.code === 'FACE_MISMATCH') setFaceError('mismatch')
      else if (err.code === 'NONCE_USED' || err.code === 'NONCE_INVALID') setFaceError('nonce')
      else setResult('failed')
      setFace(null)
    } finally {
      setSubmitting(false)
    }
  }

  if (openSession === undefined) return null
  if (openSession === null) {
    return <div className="v2-notice v2-notice-info">{t('noOpenSession')}</div>
  }

  return (
    <div className="v2-card" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('checkInCardHeading')}</div>

      {result === 'success' && <div className="v2-notice" style={{ background: 'var(--v2-success-bg, #ecfdf5)', color: 'var(--v2-success-fg, #065f46)' }}>{t('checkInSuccess')}</div>}
      {result === 'failed' && <div className="v2-notice v2-notice-error">{t('checkInFailed')}</div>}

      {result !== 'success' && openSession.check_in_method === 'emoji' && (
        <>
          <p style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)', margin: '0 0 12px' }}>{t('checkInMethodEmojiHint')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {EMOJI_PALETTE.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={submitting}
                onClick={() => submitCheckIn(emoji)}
                style={{ fontSize: '1.8rem', padding: '10px 0', borderRadius: 10, border: '1px solid var(--v2-border-strong)', background: '#fff', cursor: 'pointer' }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}

      {result !== 'success' && openSession.check_in_method === 'qr' && (
        <>
          <p style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)', margin: '0 0 12px' }}>{t('checkInMethodQrHint')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('enterCodeManually')}
              style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--v2-border-strong)', borderRadius: 8, fontFamily: 'monospace' }}
            />
            <button type="button" className="v2-btn v2-btn-primary" disabled={submitting || !code.trim()} onClick={() => submitCheckIn(code.trim())}>
              {t('submitCheckIn')}
            </button>
          </div>
        </>
      )}

      {result !== 'success' && openSession.check_in_method === 'face' && (
        <>
          <p style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)', margin: '0 0 12px' }}>{t('checkInMethodFaceHint')}</p>

          {face ? (
            <FaceScanner
              key={face.attempt}
              challenge={face.challenge}
              onCapture={handleFaceCaptured}
              onError={() => setResult('failed')}
            />
          ) : (
            <button type="button" className="v2-btn v2-btn-primary" disabled={submitting} onClick={startFaceCapture}>
              {t('startFaceCheckIn')}
            </button>
          )}

          {faceError === 'notEnrolled' && (
            <div className="v2-notice v2-notice-info" style={{ marginTop: 12 }}>
              {t('faceNotEnrolled')} <Link to="/v2/face/enroll">{t('faceEnrollNow')}</Link>
            </div>
          )}
          {faceError === 'mismatch' && (
            <div className="v2-notice v2-notice-error" style={{ marginTop: 12 }}>{t('faceMismatch')}</div>
          )}
          {faceError === 'nonce' && (
            <div className="v2-notice v2-notice-error" style={{ marginTop: 12 }}>{t('faceNonceExpired')}</div>
          )}
          {faceError && (
            <button type="button" className="v2-btn" style={{ marginTop: 8 }} disabled={submitting} onClick={startFaceCapture}>
              {t('faceRetry')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
