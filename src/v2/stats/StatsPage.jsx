import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { getSectionStats, getStudentStats } from './api.js'

function formatRate(rate, notEnoughDataLabel) {
  return rate !== null ? `${(rate * 100).toFixed(1)}%` : notEnoughDataLabel
}

function formatGrade(grade, notEnoughDataLabel) {
  return grade !== null ? `${grade.toFixed(1)}%` : notEnoughDataLabel
}

export default function StatsPage() {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const { user } = useV2Auth()

  const [view, setView] = useState(null) // 'class' | 'personal'
  const [classStats, setClassStats] = useState(null)
  const [personalStats, setPersonalStats] = useState(null)
  const [status, setStatus] = useState('loading')

  // The class-wide endpoint is manager-only (owner/teacher/ta); a plain student's own membership
  // never has those roles, so a 403 here is the normal, expected signal to fall back to their own
  // personal view rather than a separate up-front roles lookup.
  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await getSectionStats(sectionId)
      setClassStats(result)
      setView('class')
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && user?.id) {
        try {
          const personal = await getStudentStats(sectionId, user.id)
          setPersonalStats(personal)
          setView('personal')
          setStatus('ok')
        } catch {
          setStatus('error')
        }
      } else {
        setStatus('error')
      }
    }
  }, [sectionId, user])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'error') return <RetryableError onRetry={load} />

  const notEnoughData = t('statsNotEnoughData')

  if (view === 'personal') {
    return (
      <div>
        <h1 className="v2-h1">{t('statsPersonalHeading')}</h1>
        <div className="v2-card" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 16 }}>
          <StatTile label={t('statsPersonalAttendance')} value={formatRate(personalStats.attendanceRate, notEnoughData)} />
          <StatTile label={t('statsPersonalGrade')} value={formatGrade(personalStats.finalGrade, notEnoughData)} />
        </div>
      </div>
    )
  }

  const { summary, students } = classStats

  return (
    <div>
      <h1 className="v2-h1">{t('statsHeading')}</h1>

      <div style={{ fontWeight: 600, margin: '20px 0 12px' }}>{t('statsSummaryHeading')}</div>
      <div className="v2-card" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <StatTile label={t('statsAvgAttendance')} value={formatRate(summary.averageAttendanceRate, notEnoughData)} />
        <StatTile label={t('statsAvgGrade')} value={formatGrade(summary.averageFinalGrade, notEnoughData)} />
        <StatTile label={t('statsMinGrade')} value={formatGrade(summary.minFinalGrade, notEnoughData)} />
        <StatTile label={t('statsMaxGrade')} value={formatGrade(summary.maxFinalGrade, notEnoughData)} />
        <StatTile label={t('statsTotalPosts')} value={summary.totalPosts} />
        <StatTile label={t('statsTotalComments')} value={summary.totalComments} />
        <StatTile label={t('statsTotalLikes')} value={summary.totalLikes} />
      </div>

      <div style={{ fontWeight: 600, margin: '24px 0 12px' }}>{t('statsPerStudentHeading')}</div>
      <table className="v2-table">
        <thead>
          <tr>
            <th>{t('colName')}</th>
            <th>{t('colAttendanceRate')}</th>
            <th>{t('colFinalGrade')}</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.userId}>
              <td>{student.displayName}</td>
              <td className="is-muted">{formatRate(student.attendanceRate, notEnoughData)}</td>
              <td style={{ fontWeight: 600 }}>{formatGrade(student.finalGrade, notEnoughData)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatTile({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '.78rem', color: 'var(--v2-ink-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{value}</div>
    </div>
  )
}
