import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError, RoleBadges } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { getCourse, getSection, inviteMember, listMemberships, regenerateJoinCode, removeMember } from './api.js'

const MANAGER_ROLES = ['owner', 'teacher', 'ta']

function sectionHeading(course, section) {
  return `${course.code} — ${course.title} · ${section.term}${section.label !== 'default' ? ` (${section.label})` : ''}`
}

export default function SectionDetailPage() {
  const { user } = useV2Auth()
  const { t } = useI18n()
  const { sectionId } = useParams()

  const [data, setData] = useState(null) // { section, course, memberships }
  const [status, setStatus] = useState('loading') // loading | ok | forbidden | error

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [sectionResult, membershipsResult] = await Promise.all([
        getSection(sectionId),
        listMemberships(sectionId),
      ])
      const courseResult = await getCourse(sectionResult.section.course_id)
      setData({ section: sectionResult.section, course: courseResult.course, memberships: membershipsResult.memberships })
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [sectionId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  const myMembership = data.memberships.find((m) => m.user_id === user?.id)
  const myRoles = myMembership?.roles ?? []
  const isManager = user?.isPlatformAdmin || myRoles.some((role) => MANAGER_ROLES.includes(role))

  return isManager
    ? <ManagerView data={data} myRoles={myRoles} onChanged={load} />
    : <StudentView data={data} myRoles={myRoles} />
}

function ManagerView({ data, myRoles, onChanged }) {
  const { t } = useI18n()
  const { section, course, memberships } = data
  const canRegenerate = myRoles.includes('owner') || myRoles.includes('teacher')
  const canGrantOwner = myRoles.includes('owner')

  const [copied, setCopied] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('student')
  const [inviteError, setInviteError] = useState(null)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(section.join_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied by the browser; the code is still visibly selectable.
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      await regenerateJoinCode(section.id)
      onChanged()
    } finally {
      setRegenerating(false)
    }
  }

  async function handleInvite(event) {
    event.preventDefault()
    setInviteError(null)
    setInviteSubmitting(true)
    try {
      await inviteMember(section.id, inviteEmail.trim(), inviteRole)
      setInviteEmail('')
      onChanged()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'USER_NOT_FOUND') setInviteError(t('inviteUserNotFound'))
      else setInviteError(t('genericError'))
    } finally {
      setInviteSubmitting(false)
    }
  }

  async function handleRemove(targetUserId, targetRoles) {
    if (!window.confirm(t('removeConfirm'))) return
    await removeMember(section.id, targetUserId, targetRoles)
    onChanged()
  }

  return (
    <div>
      <h1 className="v2-h1">{sectionHeading(course, section)}</h1>

      <div className="v2-card v2-joincode-card">
        <div>
          <div className="v2-joincode-label">{t('joinCodeCardLabel')}</div>
          <div className="v2-joincode-value">{section.join_code}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="v2-btn v2-btn-secondary" onClick={copyCode}>{copied ? t('copied') : t('copy')}</button>
          {canRegenerate
            ? <button type="button" className="v2-btn v2-btn-tint" onClick={handleRegenerate} disabled={regenerating}>{t('regenerate')}</button>
            : <span style={{ fontSize: '.72rem', color: 'var(--v2-ink-faint)', maxWidth: 150 }}>{t('regenerateHint')}</span>}
        </div>
      </div>

      <form onSubmit={handleInvite} className="v2-card" style={{ marginBottom: 16 }}>
        <div className="v2-invite-row">
          <span style={{ fontWeight: 500, fontSize: '.85rem' }}>{t('inviteByEmail')}</span>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder={t('inviteEmailPlaceholder')}
            required
          />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="student">{t('roleStudent')}</option>
            <option value="ta">{t('roleTa')}</option>
            <option value="teacher">{t('roleTeacher')}</option>
            {canGrantOwner && <option value="owner">{t('roleOwner')}</option>}
          </select>
          <button type="submit" className="v2-btn v2-btn-primary" disabled={inviteSubmitting}>{t('invite')}</button>
        </div>
        {inviteError && <p className="v2-field-error" style={{ margin: 0 }}>{inviteError}</p>}
      </form>

      <table className="v2-table">
        <thead>
          <tr>
            <th>{t('colName')}</th>
            <th>{t('colEmail')}</th>
            <th>{t('colRoles')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {memberships.map((member) => (
            <tr key={member.user_id}>
              <td>{member.display_name}</td>
              <td className="is-muted">{member.email}</td>
              <td><RoleBadges roles={member.roles} /></td>
              <td style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  className="v2-btn v2-btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '.75rem' }}
                  onClick={() => handleRemove(member.user_id, member.roles)}
                >
                  {t('remove')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StudentView({ data, myRoles }) {
  const { t } = useI18n()
  const { section, course, memberships } = data
  return (
    <div className="v2-content-narrow">
      <div className="v2-card" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>{sectionHeading(course, section)}</div>
        <div>
          <span style={{ fontSize: '.75rem', color: 'var(--v2-ink-muted)', marginRight: 8 }}>{t('studentHomeYourRole')}:</span>
          <RoleBadges roles={myRoles} />
        </div>
      </div>
      <div className="v2-notice v2-notice-info">{t('studentHomeCeiling')}</div>
      <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--v2-ink-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
        {t('studentHomeRoster')}
      </div>
      <div style={{ background: '#fff', border: '1px solid var(--v2-border)', borderRadius: 12, overflow: 'hidden' }}>
        {memberships.map((member) => (
          <div key={member.user_id} style={{ padding: '12px 14px', borderTop: '1px solid var(--v2-border)', fontSize: '.88rem' }}>
            {member.display_name}
          </div>
        ))}
      </div>
    </div>
  )
}
