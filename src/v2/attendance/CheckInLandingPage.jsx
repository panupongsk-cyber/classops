import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { checkIn } from './api.js'

export default function CheckInLandingPage() {
  const { t } = useI18n()
  const { user, loading } = useV2Auth()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('pending') // pending | success | failed

  const sessionId = searchParams.get('session')
  const code = searchParams.get('code')

  useEffect(() => {
    if (loading || !user || !sessionId || !code) return
    checkIn(sessionId, code).then(() => setStatus('success')).catch(() => setStatus('failed'))
  }, [loading, user, sessionId, code])

  return (
    <main className="v2-auth-page">
      <section className="v2-auth-card" style={{ textAlign: 'center' }}>
        <div className="v2-brand">ClassOps <span>v2</span></div>
        <h1>{t('checkinLandingHeading')}</h1>
        {loading && <p className="v2-subtitle">{t('loading')}</p>}
        {!loading && !user && (
          <>
            <p className="v2-subtitle">{t('checkinLandingNeedsLogin')}</p>
            <Link to="/login" className="v2-brand">{t('goToLogin')}</Link>
          </>
        )}
        {!loading && user && status === 'pending' && <p className="v2-subtitle">{t('loading')}</p>}
        {!loading && user && status === 'success' && <p className="v2-subtitle">{t('checkinLandingSuccess')}</p>}
        {!loading && user && status === 'failed' && <p className="v2-subtitle">{t('checkinLandingFailed')}</p>}
      </section>
    </main>
  )
}
