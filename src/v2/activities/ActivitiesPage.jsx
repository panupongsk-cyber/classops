import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { EmptyState, ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { listMemberships } from '../sections/api.js'
import { attachActivity, listActivities, listPackages, localized, percent, updateActivity } from './api.js'
import { activityErrorText } from './PlayerPage.jsx'

const MANAGER_ROLES = ['owner', 'teacher', 'ta']

function formatWhen(value) {
  return value ? new Date(value).toLocaleString() : null
}

export default function ActivitiesPage() {
  const { user } = useV2Auth()
  const { t, lang } = useI18n()
  const { sectionId } = useParams()
  const [status, setStatus] = useState('loading')
  const [activities, setActivities] = useState([])
  const [roles, setRoles] = useState([])
  const [packages, setPackages] = useState([])

  const isManager = Boolean(user?.isPlatformAdmin) || roles.some((r) => MANAGER_ROLES.includes(r))
  const isStudent = roles.includes('student')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [list, members] = await Promise.all([listActivities(sectionId), listMemberships(sectionId)])
      const mine = members.memberships.find((m) => m.user_id === user?.id)
      const myRoles = mine?.roles ?? []
      setRoles(myRoles)
      setActivities(list.activities)
      if (user?.isPlatformAdmin || myRoles.some((r) => MANAGER_ROLES.includes(r))) {
        setPackages((await listPackages()).packages)
      }
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [sectionId, user])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  return (
    <div>
      <h1 className="v2-h1">{t('activitiesHeading')}</h1>
      <p className="v2-subtext">{isManager ? t('activitiesManagerSubtext') : t('activitiesStudentSubtext')}</p>

      {isManager && <AttachForm sectionId={sectionId} packages={packages} onAttached={load} />}

      {activities.length === 0 ? (
        <EmptyState icon="🎮" heading={t('activitiesEmptyHeading')} body={isManager ? t('activitiesEmptyManager') : t('activitiesEmptyStudent')} />
      ) : (
        activities.map((activity) => (
          <div key={activity.id} className="v2-card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{localized(activity.title, lang)}</div>
                <div className="v2-subtext" style={{ margin: '4px 0 0' }}>
                  <StatusBadge activity={activity} />
                  {activity.dueAt && <span>{t('activityDue', { when: formatWhen(activity.dueAt) })} · </span>}
                  {activity.maxAttempts !== null
                    ? t('activityAttemptsUsedMax', { used: activity.myAttempts.length, max: activity.maxAttempts })
                    : isStudent && t('activityAttemptsUsed', { used: activity.myAttempts.length })}
                </div>
              </div>
              {isStudent && <StudentActions sectionId={sectionId} activity={activity} />}
            </div>
            {isStudent && activity.myAttempts.some((a) => a.status === 'finished') && (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {activity.myAttempts.filter((a) => a.status === 'finished').map((a) => (
                  <Link key={a.id} className="v2-btn-sm v2-btn-outline" to={`/v2/sections/${sectionId}/activities/attempts/${a.id}`}>
                    {t('activityAttemptResult', { n: a.attemptNo, pct: percent(a.scoreRatio) })}
                  </Link>
                ))}
              </div>
            )}
            {isManager && <ManagerControls sectionId={sectionId} activity={activity} onChanged={load} />}
          </div>
        ))
      )}
    </div>
  )
}

function StatusBadge({ activity }) {
  const { t } = useI18n()
  if (activity.status === 'draft') return <span className="v2-badge v2-badge-student">{t('activityStatusDraft')}</span>
  if (activity.availableNow) return <span className="v2-badge v2-badge-teacher">{t('activityStatusOpen')}</span>
  return <span className="v2-badge v2-badge-ta">{t('activityStatusClosed')}</span>
}

function StudentActions({ sectionId, activity }) {
  const { t } = useI18n()
  const inProgress = activity.myAttempts.some((a) => a.status === 'in_progress')
  const limitReached = activity.maxAttempts !== null && activity.myAttempts.length >= activity.maxAttempts
  if (inProgress) {
    return <Link className="v2-btn v2-btn-primary" to={`/v2/sections/${sectionId}/activities/${activity.id}/play`}>{t('activityResume')}</Link>
  }
  if (!activity.availableNow) return null
  if (limitReached) return <span className="v2-subtext">{t('activityError_ATTEMPT_LIMIT_REACHED')}</span>
  return (
    <Link className="v2-btn v2-btn-primary" to={`/v2/sections/${sectionId}/activities/${activity.id}/play`}>
      {activity.myAttempts.length === 0 ? t('activityStart') : t('activityStartAgain')}
    </Link>
  )
}

function AttachForm({ sectionId, packages, onAttached }) {
  const { t, lang } = useI18n()
  const [packageId, setPackageId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [maxAttempts, setMaxAttempts] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await attachActivity(sectionId, {
        packageId,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        maxAttempts: maxAttempts ? Number(maxAttempts) : null,
      })
      setPackageId('')
      setDueAt('')
      setMaxAttempts('')
      await onAttached()
    } catch (err) {
      setError(activityErrorText(t, err instanceof ApiError ? err.code : 'REQUEST_FAILED'))
    } finally {
      setSubmitting(false)
    }
  }

  if (packages.length === 0) {
    return <div className="v2-notice v2-notice-info">{t('activityNoPackages')}</div>
  }
  return (
    <form className="v2-card" style={{ marginBottom: 20 }} onSubmit={handleSubmit}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('activityAttachHeading')}</div>
      <div className="v2-invite-row">
        <select aria-label={t('activityPackageLabel')} value={packageId} onChange={(e) => setPackageId(e.target.value)} required>
          <option value="">{t('activityPackageLabel')}</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {localized(p.title, lang)} (v{p.version}, {p.languages.join('/')}, {t('activityItemCount', { n: p.itemCount })})
            </option>
          ))}
        </select>
        <label className="v2-subtext" style={{ margin: 0 }}>
          {t('activityDueLabel')} <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label className="v2-subtext" style={{ margin: 0 }}>
          {t('activityMaxAttemptsLabel')} <input type="number" min="1" style={{ width: 70 }} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
        </label>
        <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting || !packageId}>{t('activityAttachCta')}</button>
      </div>
      <p className="v2-field-hint">{t('activityAttachHint')}</p>
      {error && <p className="v2-field-error">{error}</p>}
    </form>
  )
}

function ManagerControls({ sectionId, activity, onChanged }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function change(payload) {
    setBusy(true)
    setError(null)
    try {
      await updateActivity(activity.id, payload)
      await onChanged()
    } catch (err) {
      setError(activityErrorText(t, err instanceof ApiError ? err.code : 'REQUEST_FAILED'))
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--v2-border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {activity.status !== 'open' && (
        <button type="button" className="v2-btn-sm v2-btn-outline" disabled={busy} onClick={() => change({ status: 'open' })}>{t('activityOpenCta')}</button>
      )}
      {activity.status === 'open' && (
        <button type="button" className="v2-btn-sm v2-btn-outline" disabled={busy} onClick={() => change({ status: 'closed' })}>{t('activityCloseCta')}</button>
      )}
      <label className="v2-subtext" style={{ margin: 0 }}>
        {t('activityEvidencePolicyLabel')}{' '}
        <select value={activity.evidencePolicy} disabled={busy} onChange={(e) => change({ evidencePolicy: e.target.value })}>
          <option value="first">{t('activityPolicyFirst')}</option>
          <option value="best">{t('activityPolicyBest')}</option>
          <option value="last">{t('activityPolicyLast')}</option>
        </select>
      </label>
      <Link className="v2-btn-sm v2-btn-outline" to={`/v2/sections/${sectionId}/activities/${activity.id}/evidence`}>{t('activityEvidenceCta')}</Link>
      {error && <span className="v2-field-error">{error}</span>}
    </div>
  )
}
