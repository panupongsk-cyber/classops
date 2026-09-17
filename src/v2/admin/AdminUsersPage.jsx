import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { listAdminUsers, updateUserRole, updateUserStatus } from './api.js'

export default function AdminUsersPage() {
  const { user: currentUser } = useV2Auth()
  const { t } = useI18n()

  const [users, setUsers] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Confirmation modal state
  const [targetUser, setTargetUser] = useState(null)
  const [actionType, setActionType] = useState(null) // 'promote' | 'demote' | 'suspend' | 'activate'
  const [actionError, setActionError] = useState(null)
  const [actionPending, setActionPending] = useState(false)

  const load = useCallback(async (p = page, s = search, r = roleFilter) => {
    setLoading(true)
    setError(false)
    try {
      const result = await listAdminUsers({ search: s, role: r, page: p, limit: 20 })
      setUsers(result.users)
      setTotal(result.total)
      setPage(result.page)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [page, search, roleFilter])

  useEffect(() => {
    load(page, search, roleFilter)
  }, [page, roleFilter, load])

  function handleSearchSubmit(e) {
    e.preventDefault()
    setPage(1)
    load(1, search, roleFilter)
  }

  async function executeAction() {
    if (!targetUser || !actionType) return
    setActionPending(true)
    setActionError(null)

    try {
      if (actionType === 'promote') {
        await updateUserRole(targetUser.id, true)
      } else if (actionType === 'demote') {
        await updateUserRole(targetUser.id, false)
      } else if (actionType === 'suspend') {
        await updateUserStatus(targetUser.id, 'suspended')
      } else if (actionType === 'activate') {
        await updateUserStatus(targetUser.id, 'active')
      }
      setTargetUser(null)
      setActionType(null)
      load(page, search, roleFilter)
    } catch (err) {
      const msg = err?.message || t('adminActionErrorGeneric')
      setActionError(msg)
    } finally {
      setActionPending(false)
    }
  }

  const limit = 20
  const maxPages = Math.ceil(total / limit) || 1

  return (
    <div className="v2-admin-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to="/v2/admin" style={{ fontSize: '.85rem', color: 'var(--v2-primary)' }}>&larr; {t('adminBackToOverview')}</Link>
          </div>
          <h1 className="v2-h1" style={{ margin: '6px 0 0' }}>{t('adminUsersTitle')}</h1>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260 }}>
          <input
            type="text"
            className="v2-input"
            style={{ flex: 1 }}
            placeholder={t('adminSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="v2-btn v2-btn-secondary">{t('adminSearchBtn')}</button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>{t('adminFilterRole')}:</label>
          <select
            className="v2-input"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">{t('adminRoleAll')}</option>
            <option value="admin">{t('adminRoleAdminsOnly')}</option>
          </select>
        </div>
      </div>

      {error ? (
        <RetryableError onRetry={() => load(page, search, roleFilter)} />
      ) : loading && !users ? (
        <LoadingRows count={5} />
      ) : users && users.length === 0 ? (
        <div className="v2-state" style={{ padding: '40px 0' }}>
          <p className="v2-state-heading">{t('adminNoUsersFound')}</p>
        </div>
      ) : (
        <>
          <table className="v2-table">
            <thead>
              <tr>
                <th>{t('adminColUser')}</th>
                <th>{t('adminColRole')}</th>
                <th>{t('adminColStatus')}</th>
                <th>{t('adminColSections')}</th>
                <th>{t('adminColJoined')}</th>
                <th style={{ textAlign: 'right' }}>{t('adminColActions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {u.displayName} {isSelf && <span style={{ fontSize: '.75rem', color: 'var(--v2-primary)' }}>({t('adminBadgeYou')})</span>}
                      </div>
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
                    <td>
                      <span style={{ fontSize: '.9rem', fontWeight: 600 }}>{u.sectionCount}</span>
                    </td>
                    <td style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        {u.isPlatformAdmin ? (
                          <button
                            type="button"
                            className="v2-btn-sm v2-btn-outline"
                            disabled={isSelf}
                            title={isSelf ? t('adminCannotDemoteSelfHint') : undefined}
                            onClick={() => {
                              setTargetUser(u)
                              setActionType('demote')
                              setActionError(null)
                            }}
                          >
                            {t('adminActionDemote')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="v2-btn-sm v2-btn-outline"
                            onClick={() => {
                              setTargetUser(u)
                              setActionType('promote')
                              setActionError(null)
                            }}
                          >
                            {t('adminActionPromote')}
                          </button>
                        )}

                        {u.status === 'active' ? (
                          <button
                            type="button"
                            className="v2-btn-sm v2-btn-danger"
                            disabled={isSelf}
                            title={isSelf ? t('adminCannotSuspendSelfHint') : undefined}
                            onClick={() => {
                              setTargetUser(u)
                              setActionType('suspend')
                              setActionError(null)
                            }}
                          >
                            {t('adminActionSuspend')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="v2-btn-sm v2-btn-outline"
                            onClick={() => {
                              setTargetUser(u)
                              setActionType('activate')
                              setActionError(null)
                            }}
                          >
                            {t('adminActionActivate')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {total > limit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
              <div style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>
                {t('adminPaginationShowing', {
                  from: (page - 1) * limit + 1,
                  to: Math.min(page * limit, total),
                  total,
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="v2-btn v2-btn-secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  &larr; {t('adminPaginationPrev')}
                </button>
                <button
                  type="button"
                  className="v2-btn v2-btn-secondary"
                  disabled={page >= maxPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('adminPaginationNext')} &rarr;
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal */}
      {targetUser && actionType && (
        <div className="v2-modal-backdrop" onClick={() => !actionPending && setTargetUser(null)}>
          <div className="v2-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ margin: '0 0 12px' }}>
              {actionType === 'promote' && t('adminModalPromoteTitle')}
              {actionType === 'demote' && t('adminModalDemoteTitle')}
              {actionType === 'suspend' && t('adminModalSuspendTitle')}
              {actionType === 'activate' && t('adminModalActivateTitle')}
            </h3>

            <p style={{ margin: '0 0 16px', fontSize: '.9rem', color: 'var(--v2-ink-muted)' }}>
              {actionType === 'promote' && t('adminModalPromoteBody', { name: targetUser.displayName, email: targetUser.email })}
              {actionType === 'demote' && t('adminModalDemoteBody', { name: targetUser.displayName, email: targetUser.email })}
              {actionType === 'suspend' && t('adminModalSuspendBody', { name: targetUser.displayName, email: targetUser.email })}
              {actionType === 'activate' && t('adminModalActivateBody', { name: targetUser.displayName, email: targetUser.email })}
            </p>

            {actionError && (
              <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#b91c1c', padding: '8px 12px', borderRadius: 6, fontSize: '.85rem', marginBottom: 16 }}>
                {actionError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="v2-btn v2-btn-secondary"
                disabled={actionPending}
                onClick={() => setTargetUser(null)}
              >
                {t('adminModalCancel')}
              </button>
              <button
                type="button"
                className={`v2-btn ${actionType === 'suspend' || actionType === 'demote' ? 'v2-btn-danger' : 'v2-btn-primary'}`}
                disabled={actionPending}
                onClick={executeAction}
              >
                {actionPending ? t('adminModalProcessing') : t('adminModalConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
