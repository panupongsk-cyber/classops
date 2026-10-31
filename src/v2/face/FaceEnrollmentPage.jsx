import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { putFaceEnrollment } from '../attendance/api.js'
import FaceScanner from './FaceScanner.jsx'

const TARGET_CAPTURES = 5
const MIN_CAPTURES = 3

/**
 * Self-service face enrollment: capture 3-5 faces at prompted poses (each gated by a blink so a
 * static photo can't enroll), then store the 128-D embeddings server-side. No image ever leaves the
 * device. The teacher can clear this enrollment to force a re-enroll.
 */
export default function FaceEnrollmentPage() {
  const { t } = useI18n()
  const [captures, setCaptures] = useState([])
  const [showScanner, setShowScanner] = useState(true)
  const [status, setStatus] = useState('capturing') // capturing | saving | saved | error
  const [error, setError] = useState('')

  function handleCapture(descriptor) {
    setCaptures((current) => [...current, descriptor])
    setShowScanner(false)
  }

  async function save() {
    setStatus('saving')
    try {
      await putFaceEnrollment(captures, 'blink')
      setStatus('saved')
    } catch (err) {
      setStatus('error')
      setError(err?.code === 'INVALID_REQUEST' ? 'faceInvalid' : 'faceSaveFailed')
    }
  }

  if (status === 'saved') {
    return (
      <main className="v2-auth-page">
        <section className="v2-auth-card">
          <h1>{t('faceEnrollDone')}</h1>
          <p className="v2-subtitle">{t('faceEnrollDoneSub')}</p>
          <Link to="/v2/account" className="v2-btn v2-btn-primary">{t('backToAccount')}</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="v2-auth-page">
      <section className="v2-auth-card">
        <h1>{t('faceEnrollHeading')}</h1>
        <p className="v2-subtitle">{t('faceEnrollSub')}</p>
        <p style={{ textAlign: 'center', fontSize: '.9rem', color: 'var(--v2-ink-muted)', margin: '0 0 12px' }}>
          {t('faceEnrollProgress', { count: captures.length, target: TARGET_CAPTURES })}
        </p>

        {status === 'error' && <div className="v2-notice v2-notice-error" style={{ marginBottom: 12 }}>{t(error)}</div>}

        {showScanner && captures.length < TARGET_CAPTURES ? (
          <FaceScanner
            key={captures.length}
            challenge={null}
            onCapture={handleCapture}
            onError={(code) => { setStatus('error'); setError(code) }}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {captures.length < TARGET_CAPTURES ? (
              <button type="button" className="v2-btn v2-btn-primary" onClick={() => setShowScanner(true)}>
                {t('faceEnrollNext')}
              </button>
            ) : (
              <button type="button" className="v2-btn v2-btn-primary" disabled={status === 'saving'} onClick={save}>
                {status === 'saving' ? t('faceSaving') : t('faceEnrollSave')}
              </button>
            )}
            {captures.length >= MIN_CAPTURES && captures.length < TARGET_CAPTURES && (
              <button type="button" className="v2-btn" disabled={status === 'saving'} onClick={save}>
                {status === 'saving' ? t('faceSaving') : t('faceEnrollSave')}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
