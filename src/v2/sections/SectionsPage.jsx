import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { EmptyState, LoadingRows, RetryableError, RoleBadges } from '../components/StateViews.jsx'
import { listMySections } from './api.js'
import JoinCodeModal from './JoinCodeModal.jsx'

const STACK_ICON = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--v2-primary)" strokeWidth="1.6">
    <rect x="4" y="4" width="16" height="4" rx="1" />
    <rect x="4" y="10" width="16" height="4" rx="1" />
    <rect x="4" y="16" width="10" height="4" rx="1" />
  </svg>
)

export default function SectionsPage() {
  const { user } = useV2Auth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [sections, setSections] = useState(null)
  const [error, setError] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    setSections(null)
    try {
      const result = await listMySections()
      setSections(result.sections)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) return <RetryableError onRetry={load} />
  if (sections === null) return <LoadingRows />

  if (sections.length === 0) {
    const action = user?.isPlatformAdmin
      ? <Link to="/v2/courses/new" className="v2-btn v2-btn-primary">{t('createCourseCta')}</Link>
      : <button type="button" className="v2-btn v2-btn-primary" onClick={() => setShowJoinModal(true)}>{t('joinWithCodeCta')}</button>

    return (
      <>
        <EmptyState
          icon={STACK_ICON}
          heading={user?.isPlatformAdmin ? t('sectionsEmptyAdminHeading') : t('sectionsEmptyManagerHeading')}
          body={user?.isPlatformAdmin ? t('sectionsEmptyAdminBody') : t('sectionsEmptyManagerBody')}
          action={action}
        />
        {showJoinModal && (
          <JoinCodeModal
            onClose={() => setShowJoinModal(false)}
            onJoined={(sectionId) => navigate(`/v2/sections/${sectionId}`)}
          />
        )}
      </>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 className="v2-h1" style={{ margin: 0 }}>{t('mySectionsTitle')}</h1>
        <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setShowJoinModal(true)}>{t('joinWithCodeCta')}</button>
      </div>
      <table className="v2-table">
        <thead>
          <tr>
            <th>{t('colName')}</th>
            <th>{t('colRoles')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <tr key={section.section_id}>
              <td>{section.course_code} — {section.course_title} · {section.term}{section.label !== 'default' ? ` (${section.label})` : ''}</td>
              <td><RoleBadges roles={section.roles} /></td>
              <td style={{ textAlign: 'right' }}>
                {section.roles.includes('owner') && (
                  <Link to={`/v2/courses/${section.course_id}/sections/new`} style={{ marginRight: 16 }}>{t('addSectionCta')}</Link>
                )}
                <Link to={`/v2/sections/${section.section_id}`}>{t('openSection')}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showJoinModal && (
        <JoinCodeModal
          onClose={() => setShowJoinModal(false)}
          onJoined={(sectionId) => navigate(`/v2/sections/${sectionId}`)}
        />
      )}
    </div>
  )
}
