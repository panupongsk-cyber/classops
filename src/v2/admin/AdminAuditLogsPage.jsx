import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { listAdminAuditLogs } from './api.js'

export default function AdminAuditLogsPage() {
  const { t } = useI18n()

  const [logs, setLogs] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // JSON viewer modal
  const [inspectLog, setInspectLog] = useState(null)

  const load = useCallback(async (p = page, s = search, c = category) => {
    setLoading(true)
    setError(false)
    try {
      const result = await listAdminAuditLogs({ search: s, category: c, page: p, limit: 25 })
      setLogs(result.logs || [])
      setTotal(result.total || 0)
      setPage(result.page || 1)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [page, search, category])

  useEffect(() => {
    load(page, search, category)
  }, [page, category, load])

  function handleSearchSubmit(e) {
    e.preventDefault()
    setPage(1)
    load(1, search, category)
  }

  function getEventBadgeStyle(eventType) {
    if (eventType.startsWith('auth.')) {
      return { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' }
    }
    if (eventType.startsWith('admin.')) {
      return { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' }
    }
    if (eventType.startsWith('section.')) {
      return { bg: '#fef3c7', color: '#b45309', border: '#fde68a' }
    }
    if (eventType.startsWith('session.')) {
      return { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' }
    }
    return { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' }
  }

  const limit = 25
  const maxPages = Math.ceil(total / limit) || 1

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
          <h1 className="v2-h1" style={{ margin: '6px 0 0' }}>{t('adminAuditTitle')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
            {t('adminAuditSubtitle')}
          </p>
        </div>
      </div>

      {/* Filter toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260 }}>
          <input
            type="text"
            className="v2-input"
            style={{ flex: 1 }}
            placeholder={t('adminAuditSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="v2-btn v2-btn-secondary">
            {t('adminSearchBtn')}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>{t('adminAuditCategoryFilter')}:</span>
          <select
            className="v2-select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">{t('adminAuditCatAll')}</option>
            <option value="admin">{t('adminAuditCatAdmin')}</option>
            <option value="section">{t('adminAuditCatSection')}</option>
            <option value="session">{t('adminAuditCatSession')}</option>
            <option value="auth">{t('adminAuditCatAuth')}</option>
            <option value="user">{t('adminAuditCatUser')}</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {loading && <LoadingRows rows={8} />}
      {error && !loading && <RetryableError onRetry={() => load(page, search, category)} />}

      {!loading && !error && (logs || []).length === 0 && (
        <div className="v2-card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--v2-ink-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>📋</div>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500 }}>{t('adminAuditEmpty')}</p>
        </div>
      )}

      {!loading && !error && (logs || []).length > 0 && (
        <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--v2-border)', color: 'var(--v2-ink-muted)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.05em', background: 'var(--v2-surface-alt, #f8fafc)' }}>
                  <th style={{ padding: '12px 20px' }}>{t('adminAuditColTime')}</th>
                  <th style={{ padding: '12px 16px' }}>{t('adminAuditColActor')}</th>
                  <th style={{ padding: '12px 16px' }}>{t('adminAuditColEvent')}</th>
                  <th style={{ padding: '12px 16px' }}>{t('adminAuditColSubject')}</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right' }}>{t('adminColActions')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const style = getEventBadgeStyle(log.eventType)
                  const dateStr = new Date(log.createdAt).toLocaleString()

                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--v2-border)' }}>
                      {/* Timestamp */}
                      <td style={{ padding: '12px 20px', whiteSpace: 'nowrap', color: 'var(--v2-ink-muted)', fontSize: '.8rem' }}>
                        {dateStr}
                      </td>

                      {/* Actor */}
                      <td style={{ padding: '12px 16px' }}>
                        {log.actor ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{log.actor.displayName}</div>
                            <div style={{ fontSize: '.75rem', color: 'var(--v2-ink-muted)' }}>{log.actor.email}</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--v2-ink-muted)', fontStyle: 'italic', fontSize: '.8rem' }}>
                            {t('adminAuditActorSystem')}
                          </span>
                        )}
                      </td>

                      {/* Event Type Badge */}
                      <td style={{ padding: '12px 16px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            fontFamily: 'monospace',
                            fontSize: '.75rem',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: style.bg,
                            color: style.color,
                            border: `1px solid ${style.border}`,
                          }}
                        >
                          {log.eventType}
                        </span>
                      </td>

                      {/* Subject */}
                      <td style={{ padding: '12px 16px', fontSize: '.8rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--v2-ink-muted)' }}>{log.subjectType}</span>
                        {log.subjectId && (
                          <code style={{ marginLeft: 6, fontSize: '.75rem', background: '#f1f5f9', padding: '2px 4px', borderRadius: 4 }}>
                            {log.subjectId.length > 12 ? `${log.subjectId.slice(0, 8)}…` : log.subjectId}
                          </code>
                        )}
                      </td>

                      {/* Inspect Metadata Button */}
                      <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="v2-btn v2-btn-sm v2-btn-secondary"
                          style={{ fontSize: '.75rem', padding: '3px 8px' }}
                          onClick={() => setInspectLog(log)}
                        >
                          🔍 {t('adminAuditInspectBtn')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--v2-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '.85rem',
              color: 'var(--v2-ink-muted)',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              {t('adminPaginationShowing', {
                from: total === 0 ? 0 : (page - 1) * limit + 1,
                to: Math.min(page * limit, total),
                total,
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="v2-btn v2-btn-sm v2-btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('adminPaginationPrev')}
              </button>
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', fontSize: '.85rem' }}>
                {page} / {maxPages}
              </span>
              <button
                type="button"
                className="v2-btn v2-btn-sm v2-btn-secondary"
                disabled={page >= maxPages}
                onClick={() => setPage((p) => Math.min(maxPages, p + 1))}
              >
                {t('adminPaginationNext')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metadata Inspector Modal */}
      {inspectLog && (
        <div className="v2-modal-backdrop" onClick={() => setInspectLog(null)}>
          <div className="v2-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 className="v2-h2" style={{ margin: 0, fontSize: '1.15rem' }}>{t('adminAuditModalTitle')}</h2>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '.75rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: '#f1f5f9',
                }}
              >
                ID: {inspectLog.id}
              </span>
            </div>

            <div style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)', marginBottom: 12 }}>
              <strong>{inspectLog.eventType}</strong> • {new Date(inspectLog.createdAt).toLocaleString()}
            </div>

            <pre
              style={{
                background: '#0f172a',
                color: '#f8fafc',
                padding: '16px',
                borderRadius: 8,
                fontSize: '.8rem',
                maxHeight: 280,
                overflowY: 'auto',
                fontFamily: 'monospace',
                margin: '0 0 16px',
              }}
            >
              {JSON.stringify(inspectLog.metadata, null, 2)}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="v2-btn v2-btn-secondary"
                onClick={() => setInspectLog(null)}
              >
                {t('adminModalCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
