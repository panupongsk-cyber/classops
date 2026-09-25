import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { listAdminUsers } from '../admin/api.js'
import { createCourse } from './api.js'

const COURSE_TYPES = [
  { value: 'semester', labelKey: 'pillSemester' },
  { value: 'short_course', labelKey: 'pillShort' },
  { value: 'self_paced', labelKey: 'pillSelf' },
]

export default function CreateCoursePage() {
  const { user } = useV2Auth()
  const { t } = useI18n()
  const navigate = useNavigate()

  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState('semester')
  const [term, setTerm] = useState('')
  const [label, setLabel] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (!user?.isPlatformAdmin) return <ForbiddenState />

  const isSemester = type === 'semester'
  const termLabel = isSemester ? t('termLabelSemester') : t('termLabelOther')
  const termPlaceholder = isSemester ? t('termPlaceholderSemester') : t('termPlaceholderOther')

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = { code: code.trim(), title: title.trim(), type, term: term.trim() }
      if (label.trim()) payload.label = label.trim()
      const wantedOwner = ownerEmail.trim().toLowerCase()
      if (wantedOwner && wantedOwner !== user.email?.toLowerCase()) {
        // The owner must already have an account (they signed in once) and be active.
        const found = await listAdminUsers({ search: wantedOwner, limit: 50 })
        const owner = found.users.find((u) => u.email.toLowerCase() === wantedOwner)
        if (!owner) { setError(t('ownerEmailNotFound')); return }
        if (owner.status !== 'active') { setError(t('ownerEmailSuspended')); return }
        payload.ownerUserId = owner.id
      }
      const result = await createCourse(payload)
      navigate(`/v2/sections/${result.sectionId}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COURSE_CODE_ALREADY_EXISTS') {
        setError(t('courseCodeExists'))
      } else if (err instanceof ApiError && err.code === 'OWNER_USER_NOT_FOUND') {
        setError(t('ownerEmailNotFound'))
      } else if (err instanceof ApiError && err.code === 'OWNER_USER_SUSPENDED') {
        setError(t('ownerEmailSuspended'))
      } else {
        setError(t('genericError'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="v2-content-narrow">
      <div className="v2-card">
        <h1 className="v2-h1">{t('createCourseHeading')}</h1>
        <p className="v2-subtext">{t('createCourseSubheading')}</p>
        <form onSubmit={handleSubmit}>
          <div className="v2-field">
            <label htmlFor="course-code">{t('courseCodeLabel')}</label>
            <input id="course-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('courseCodePlaceholder')} required maxLength={50} />
          </div>
          <div className="v2-field">
            <label htmlFor="course-title">{t('courseTitleLabel')}</label>
            <input id="course-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('courseTitlePlaceholder')} required maxLength={200} />
          </div>
          <div className="v2-field">
            <label>{t('courseTypeLabel')}</label>
            <div className="v2-pill-group">
              {COURSE_TYPES.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`v2-pill-option ${type === option.value ? 'is-selected' : ''}`}
                  onClick={() => setType(option.value)}
                >
                  <div className="v2-pill-label">{t(option.labelKey)}</div>
                  <div className="v2-pill-code">{option.value}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="v2-field">
            <label htmlFor="course-term">{termLabel}</label>
            <input id="course-term" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={termPlaceholder} required maxLength={50} />
          </div>
          <div className="v2-field">
            <label htmlFor="course-section-label">{t('sectionLabelField')}</label>
            <input id="course-section-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sectionLabelPlaceholder')} maxLength={50} />
          </div>
          <div className="v2-field">
            <label htmlFor="course-owner-email">{t('ownerEmailLabel')}</label>
            <input id="course-owner-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder={user.email} maxLength={320} />
            <p className="v2-field-hint">{t('ownerEmailHint')}</p>
          </div>
          {error && <p className="v2-field-error">{error}</p>}
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => navigate('/v2/sections')}>{t('cancel')}</button>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting}>{t('createCourseSubmit')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
