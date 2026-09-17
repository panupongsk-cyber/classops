import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { getAdminOverview } from './api.js'

function StatCard({ title, value, hint }) {
  return (
    <div className="v2-stat-card">
      <div className="v2-stat-title">{title}</div>
      <div className="v2-stat-value">{value}</div>
      {hint && <div className="v2-stat-hint">{hint}</div>}
    </div>
  )
}

export default function AdminOverviewPage() {
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const result = await getAdminOverview()
      setData(result)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <RetryableError onRetry={load} />
  if (!data) return <LoadingRows count={5} />

  const { metrics, recentUsers } = data

  return (
    <div className="v2-admin-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="v2-h1" style={{ margin: 0 }}>{t('adminOverviewTitle')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
            {t('adminOverviewSubtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link to="/v2/admin/users" className="v2-btn v2-btn-secondary">
            {t('adminUsersCta')}
          </Link>
          <Link to="/v2/courses/new" className="v2-btn v2-btn-primary">
            + {t('createCourseCta')}
          </Link>
        </div>
      </div>

      <div className="v2-stats-grid" style={{ marginBottom: 32 }}>
        <StatCard
          title={t('adminMetricUsers')}
          value={metrics.totalUsers}
          hint={`${metrics.activeUsers} ${t('adminMetricActiveUsers')}`}
        />
        <StatCard
          title={t('adminMetricCourses')}
          value={metrics.totalCourses}
          hint={`${metrics.totalSections} ${t('adminMetricSections')}`}
        />
        <StatCard
          title={t('adminMetricLiveSessions')}
          value={metrics.liveSessionsCount}
          hint={t('adminMetricLiveHint')}
        />
        <StatCard
          title={t('adminMetricTodayCheckins')}
          value={metrics.todayCheckinsCount}
          hint={t('adminMetricCheckinHint')}
        />
      </div>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 className="v2-h2" style={{ margin: 0 }}>{t('adminRecentUsersHeading')}</h2>
          <Link to="/v2/admin/users" style={{ fontSize: '.9rem' }}>
            {t('adminViewAllUsers')} &rarr;
          </Link>
        </div>

        <table className="v2-table">
          <thead>
            <tr>
              <th>{t('adminColUser')}</th>
              <th>{t('adminColRole')}</th>
              <th>{t('adminColStatus')}</th>
              <th>{t('adminColJoined')}</th>
            </tr>
          </thead>
          <tbody>
            {recentUsers.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.displayName}</div>
                  <div style={{ fontSize: '.8rem', color: 'var(--v2-ink-muted)' }}>{u.email}</div>
                </td>
                <td>
                  {u.isPlatformAdmin ? (
                    <span className="v2-badge v2-badge-owner">{t('adminRolePlatformAdmin')}</span>
                  ) : (
                    <span className="v2-badge v2-badge-student">{t('adminRoleUser')}</span>
                  )}
                </td>
                <td>
                  <span className={`v2-badge ${u.status === 'active' ? 'v2-badge-active' : 'v2-badge-suspended'}`}>
                    {u.status === 'active' ? t('adminStatusActive') : t('adminStatusSuspended')}
                  </span>
                </td>
                <td style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
