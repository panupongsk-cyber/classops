import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'

// Shared interaction-state patterns from the v2 UI foundation spec (section 5): skeleton rows
// instead of a full-page spinner, an empty state always paired with its one resolving action, a
// forbidden state that keeps the shell and explains why, and a retry affordance scoped to just
// the region that failed.

export function LoadingRows({ count = 4 }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="v2-skeleton-row" style={{ width: `${90 - index * 8}%` }} />
      ))}
    </div>
  )
}

export function EmptyState({ icon, heading, body, action }) {
  return (
    <div className="v2-state">
      {icon && <div className="v2-state-icon">{icon}</div>}
      <h1 className="v2-state-heading">{heading}</h1>
      <p className="v2-state-body">{body}</p>
      {action}
    </div>
  )
}

export function ForbiddenState() {
  const { t } = useI18n()
  return (
    <div className="v2-state">
      <p className="v2-state-heading">{t('forbiddenHeading')}</p>
      <Link to="/v2/sections">{t('forbiddenBack')}</Link>
    </div>
  )
}

export function RetryableError({ message, onRetry }) {
  const { t } = useI18n()
  return (
    <div className="v2-retry-box">
      <p style={{ margin: '0 0 8px', fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>
        {message || t('retryFailed')}
      </p>
      <button type="button" className="v2-btn v2-btn-secondary" onClick={onRetry}>{t('retry')}</button>
    </div>
  )
}

const ROLE_BADGE_CLASS = { owner: 'v2-badge-owner', teacher: 'v2-badge-teacher', ta: 'v2-badge-ta', student: 'v2-badge-student' }
const ROLE_LABEL_KEY = { owner: 'roleOwner', teacher: 'roleTeacher', ta: 'roleTa', student: 'roleStudent' }

export function RoleBadges({ roles }) {
  const { t } = useI18n()
  return roles.map((role) => (
    <span key={role} className={`v2-badge ${ROLE_BADGE_CLASS[role] ?? 'v2-badge-student'}`}>
      {t(ROLE_LABEL_KEY[role] ?? 'roleStudent')}
    </span>
  ))
}
