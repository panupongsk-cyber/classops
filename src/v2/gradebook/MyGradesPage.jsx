import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { getMyGrades } from './api.js'

// A student's own grades (#2436): released Assignments only, with category percentages and the
// final grade computed by the server from that released work alone.
export default function MyGradesPage() {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const [grades, setGrades] = useState(null)
  const [status, setStatus] = useState('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setGrades(await getMyGrades(sectionId))
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

  const categoryById = new Map(grades.categories.map((category) => [category.id, category]))
  const activeCategories = grades.categories.filter((category) => category.percent !== null)

  return (
    <div className="v2-content-narrow">
      <h1 className="v2-h1">{t('myGradesHeading')}</h1>
      {grades.assignments.length === 0 ? (
        <p style={{ color: 'var(--v2-ink-muted)' }}>{t('myGradesNone')}</p>
      ) : (
        <>
          <div className="v2-card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '.82rem', color: 'var(--v2-ink-muted)' }}>{t('colFinalGrade')}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
              {grades.finalGrade !== null ? `${grades.finalGrade.toFixed(1)}%` : t('notEnoughData')}
            </div>
            {activeCategories.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, fontSize: '.85rem' }}>
                {activeCategories.map((category) => (
                  <span key={category.id}>
                    {category.name}: <strong>{category.percent.toFixed(1)}%</strong>
                  </span>
                ))}
              </div>
            )}
            <p style={{ fontSize: '.78rem', color: 'var(--v2-ink-muted)', margin: '8px 0 0' }}>{t('myGradesReleasedNote')}</p>
          </div>
          <table className="v2-table">
            <thead>
              <tr>
                <th>{t('colAssignment')}</th>
                <th>{t('categoriesHeading')}</th>
                <th>{t('colScore')}</th>
              </tr>
            </thead>
            <tbody>
              {grades.assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{assignment.name}</td>
                  <td className="is-muted">{categoryById.get(assignment.categoryId)?.name ?? ''}</td>
                  <td>
                    {assignment.pointsEarned !== null
                      ? `${assignment.pointsEarned} / ${assignment.maxPoints}`
                      : <span className="is-muted">{t('notScored')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
