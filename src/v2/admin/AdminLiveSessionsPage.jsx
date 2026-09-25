import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { closeAdminSession, listAdminLiveSessions } from './api.js'

export default function AdminLiveSessionsPage() {
  const { t } = useI18n()

  const [sessions, setSessions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Emergency close modal state
  const [targetSession, setTargetSession] = useState(null)
  const [modalPending, setModalPending] = useState(false)
  const [modalError, setModalError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const result = await listAdminLiveSessions()
      setSessions(result.sessions || [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Auto-refresh every 15 seconds
    const timer = setInterval(() => {
      listAdminLiveSessions()
        .then((res) => setSessions(res.sessions || []))
        .catch(() => {})
    }, 15000)
    return () => clearInterval(timer)
  }, [load])

  const totalCheckedIn = useMemo(() => {
    return (sessions || []).reduce((sum, s) => sum + (s.checkedInCount || 0), 0)
  }, [sessions])

  function openCloseModal(session) {
    setTargetSession(session)
    setModalError(null)
  }

  async function executeCloseSession() {
    if (!targetSession) return
    setModalPending(true)
    setModalError(null)
    try {
      await closeAdminSession(targetSession.id)
      setSessions((prev) => (prev || []).filter((s) => s.id !== targetSession.id))
      setTargetSession(null)
    } catch (err) {
      setModalError(err?.message || t('adminActionErrorGeneric'))
    } finally {
      setModalPending(false)
    }
  }

  return (
    <div className="v2-admin-page">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to="/v2/admin" style={{ fontSize: '.85rem', color: 'var(--v2-primary)' }}>
              &larr; {t('adminBackToOverview')}
            </Link>
          </div>
          <h1 className="v2-h1" style={{ margin: '6px 0 0' }}>{t('adminLiveTitle')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
            {t('adminLiveSubtitle')}
          </p>
        </div>
        <button
          type="button"
          className="v2-btn v2-btn-secondary"
          onClick={load}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span>🔄</span> {t('retry')}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="v2-stats-grid" style={{ marginBottom: 24 }}>
        <div className="v2-stat-card">
          <div className="v2-stat-label">{t('adminMetricLiveSessions')}</div>
          <div className="v2-stat-val" style={{ color: 'var(--v2-success, #16a34a)' }}>
            {sessions ? sessions.length : '—'}
          </div>
          <div className="v2-stat-hint">{t('adminLiveActiveCountHint')}</div>
        </div>
        <div className="v2-stat-card">
          <div className="v2-stat-label">{t('adminLiveTotalCheckins')}</div>
          <div className="v2-stat-val">
            {sessions ? totalCheckedIn : '—'}
          </div>
          <div className="v2-stat-hint">{t('adminLiveTotalCheckinsHint')}</div>
        </div>
      </div>

      {/* Content */}
      {loading && <LoadingRows rows={4} />}
      {error && !loading && <RetryableError onRetry={load} />}

      {!loading && !error && (sessions || []).length === 0 && (
        <div className="v2-card" style={{ textAlign: 'center', padding: '56px 24px', color: 'var(--v2-ink-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🟢</div>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>{t('adminLiveEmptyHeading')}</p>
          <p style={{ margin: '6px 0 0', fontSize: '.875rem' }}>{t('adminLiveEmptyBody')}</p>
        </div>
      )}

      {!loading && !error && (sessions || []).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 20 }}>
          {sessions.map((s) => {
            const pct = s.totalStudentsCount > 0
              ? Math.min(100, Math.round((s.checkedInCount / s.totalStudentsCount) * 100))
              : 0

            return (
              <div
                key={s.id}
                className="v2-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderTop: '3px solid var(--v2-success, #16a34a)',
                }}
              >
                <div>
                  {/* Top line with live badge */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '.9rem', color: 'var(--v2-primary)' }}>
                      {s.courseCode}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '.75rem',
                        fontWeight: 700,
                        color: '#15803d',
                        background: '#dcfce7',
                        padding: '2px 8px',
                        borderRadius: 12,
                        letterSpacing: '.05em',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a' }} />
                      LIVE
                    </span>
                  </div>

                  <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 600 }}>{s.courseTitle}</h3>
                  <div style={{ fontSize: '.8rem', color: 'var(--v2-ink-muted)', marginBottom: 14 }}>
                    {s.term} • {s.sectionLabel}
                  </div>

                  {/* Host info */}
                  <div style={{ padding: '8px 12px', background: 'var(--v2-surface-alt, #f8fafc)', borderRadius: 6, marginBottom: 14, fontSize: '.825rem' }}>
                    <div style={{ fontWeight: 600, color: 'var(--v2-ink)' }}>
                      👤 {s.host?.displayName || t('adminSectionNoOwner')}
                    </div>
                    {s.host?.email && (
                      <div style={{ color: 'var(--v2-ink-muted)', fontSize: '.75rem' }}>
                        {s.host.email}
                      </div>
                    )}
                  </div>

                  {/* Method & Times */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: 'var(--v2-ink-muted)', marginBottom: 14 }}>
                    <div>
                      {t('adminLiveMethod')}: <strong style={{ color: 'var(--v2-ink)' }}>
                        {s.checkInMethod === 'qr' ? '📱 QR Code' : s.checkInMethod === 'emoji' ? `😀 Emoji (${s.activeEmoji || ''})` : 'Manual'}
                      </strong>
                    </div>
                    <div>
                      {t('adminLiveStarted')}: <strong style={{ color: 'var(--v2-ink)' }}>
                        {new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </strong>
                    </div>
                  </div>

                  {/* Attendance Progress */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', fontWeight: 600, marginBottom: 6 }}>
                      <span>{t('adminLiveCheckins')}</span>
                      <span>{s.checkedInCount} / {s.totalStudentsCount} ({pct}%)</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--v2-border)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: pct >= 80 ? '#16a34a' : pct >= 50 ? '#0284c7' : '#d97706',
                          borderRadius: 4,
                          transition: 'width .3s ease',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 12, borderTop: '1px solid var(--v2-border)' }}>
                  <Link
                    to={`/v2/sections/${s.sectionId}/attendance/live/${s.id}`}
                    className="v2-btn v2-btn-sm v2-btn-secondary"
                    style={{ flex: 1, textAlign: 'center', fontSize: '.8rem' }}
                  >
                    📺 {t('adminLiveProjectorBtn')}
                  </Link>
                  <button
                    type="button"
                    className="v2-btn v2-btn-sm v2-btn-danger"
                    style={{ fontSize: '.8rem' }}
                    onClick={() => openCloseModal(s)}
                  >
                    🛑 {t('adminLiveCloseBtn')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Emergency Close Modal */}
      {targetSession && (
        <div className="v2-modal-backdrop" onClick={() => !modalPending && setTargetSession(null)}>
          <div className="v2-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h2 className="v2-h2" style={{ margin: '0 0 8px', color: '#b91c1c' }}>{t('adminModalCloseSessionTitle')}</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
              {t('adminModalCloseSessionBody', {
                course: `${targetSession.courseCode} (${targetSession.term} - ${targetSession.sectionLabel})`,
              })}
            </p>

            {modalError && (
              <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #f87171', borderRadius: 6, color: '#b91c1c', fontSize: '.85rem', marginBottom: 14 }}>
                {modalError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="v2-btn v2-btn-secondary"
                disabled={modalPending}
                onClick={() => setTargetSession(null)}
              >
                {t('adminModalCancel')}
              </button>
              <button
                type="button"
                className="v2-btn v2-btn-danger"
                disabled={modalPending}
                onClick={executeCloseSession}
              >
                {modalPending ? t('adminModalProcessing') : t('adminLiveConfirmCloseBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
