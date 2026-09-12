import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { addSection, listMySections } from './api.js'

export default function AddSectionPage() {
  const { user } = useV2Auth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { courseId } = useParams()

  const [ownedCourse, setOwnedCourse] = useState(undefined) // undefined = loading, null = not found/owned
  const [loadError, setLoadError] = useState(false)
  const [term, setTerm] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadError(false)
      setOwnedCourse(undefined)
      try {
        const result = await listMySections()
        if (cancelled) return
        const match = result.sections.find((s) => s.course_id === courseId && s.roles.includes('owner'))
        setOwnedCourse(match ?? null)
      } catch {
        if (!cancelled) setLoadError(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [courseId])

  if (loadError) return <RetryableError onRetry={() => setOwnedCourse(undefined)} />
  if (ownedCourse === undefined) return <LoadingRows />
  if (ownedCourse === null && !user?.isPlatformAdmin) return <ForbiddenState />

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = { term: term.trim() }
      if (label.trim()) payload.label = label.trim()
      const result = await addSection(courseId, payload)
      navigate(`/v2/sections/${result.sectionId}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SECTION_ALREADY_EXISTS') {
        setError(t('sectionAlreadyExists'))
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
        <h1 className="v2-h1">{t('addSectionHeading')}</h1>
        <p className="v2-subtext">
          {ownedCourse ? `${ownedCourse.course_code} — ${ownedCourse.course_title}` : t('addSectionSubheading')}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="v2-field">
            <label htmlFor="section-term">{t('termLabelSemester')} / {t('termLabelOther')}</label>
            <input id="section-term" value={term} onChange={(e) => setTerm(e.target.value)} required maxLength={50} />
          </div>
          <div className="v2-field">
            <label htmlFor="section-label">{t('sectionLabelField')}</label>
            <input id="section-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sectionLabelPlaceholder')} maxLength={50} />
          </div>
          {error && <p className="v2-field-error">{error}</p>}
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-secondary" onClick={() => navigate('/v2/sections')}>{t('cancel')}</button>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting}>{t('addSectionSubmit')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
