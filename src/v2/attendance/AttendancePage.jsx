import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { getCourse, getSection } from '../sections/api.js'
import {
  addSchedulePattern, createSession, generateSessions, listSchedulePatterns, listSessions,
  openSession, setTermDates,
} from './api.js'

const WEEKDAY_KEYS = ['weekdaySun', 'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat']

function sessionStatus(session) {
  if (session.opened_at && !session.closed_at) return 'open'
  if (session.closed_at) return 'closed'
  return 'scheduled'
}

function formatDateTime(iso) {
  const date = new Date(iso)
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AttendancePage() {
  const { t } = useI18n()
  const { sectionId } = useParams()

  const [section, setSection] = useState(null)
  const [course, setCourse] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [patterns, setPatterns] = useState(null)
  const [status, setStatus] = useState('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const sectionResult = await getSection(sectionId)
      const courseResult = await getCourse(sectionResult.section.course_id)
      setSection(sectionResult.section)
      setCourse(courseResult.course)
      if (courseResult.course.type !== 'self_paced') {
        const sessionsResult = await listSessions(sectionId)
        setSessions(sessionsResult.sessions)
        if (courseResult.course.type === 'semester') {
          const patternsResult = await listSchedulePatterns(sectionId)
          setPatterns(patternsResult.patterns)
        }
      }
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

  if (course.type === 'self_paced') {
    return (
      <div className="v2-state">
        <h1 className="v2-state-heading">{t('attendanceNotApplicableHeading')}</h1>
        <p className="v2-state-body">{t('attendanceNotApplicableBody')}</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="v2-h1">{t('navAttendance')}</h1>

      {course.type === 'semester' && (
        <SemesterSetup sectionId={sectionId} section={section} patterns={patterns} onChanged={load} />
      )}
      {course.type === 'short_course' && (
        <AddSessionForm sectionId={sectionId} onChanged={load} />
      )}

      <div style={{ fontSize: '.95rem', fontWeight: 600, margin: '24px 0 12px' }}>{t('sessionsListHeading')}</div>
      {sessions.length === 0 ? (
        <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.88rem' }}>{t('sessionsEmpty')}</p>
      ) : (
        <SessionsTable sessions={sessions} onChanged={load} />
      )}
    </div>
  )
}

function SemesterSetup({ sectionId, section, patterns, onChanged }) {
  const { t } = useI18n()
  const [termStart, setTermStart] = useState(section.term_start_date ?? '')
  const [termEnd, setTermEnd] = useState(section.term_end_date ?? '')
  const [savingTerm, setSavingTerm] = useState(false)
  const [dayOfWeek, setDayOfWeek] = useState('1')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [addingPattern, setAddingPattern] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedMsg, setGeneratedMsg] = useState(null)

  async function saveTermDates(event) {
    event.preventDefault()
    setSavingTerm(true)
    try {
      await setTermDates(sectionId, termStart, termEnd)
      onChanged()
    } finally {
      setSavingTerm(false)
    }
  }

  async function addPattern(event) {
    event.preventDefault()
    setAddingPattern(true)
    try {
      await addSchedulePattern(sectionId, Number(dayOfWeek), startTime, endTime)
      setStartTime('')
      setEndTime('')
      onChanged()
    } finally {
      setAddingPattern(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    setGeneratedMsg(null)
    try {
      const result = await generateSessions(sectionId)
      setGeneratedMsg(t('generatedCount', { count: result.createdCount }))
      onChanged()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="v2-card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('termDatesHeading')}</div>
      <form onSubmit={saveTermDates} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="v2-field" style={{ margin: 0 }}>
          <label htmlFor="term-start">{t('termStartLabel')}</label>
          <input id="term-start" type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} required />
        </div>
        <div className="v2-field" style={{ margin: 0 }}>
          <label htmlFor="term-end">{t('termEndLabel')}</label>
          <input id="term-end" type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} required />
        </div>
        <button type="submit" className="v2-btn v2-btn-secondary" disabled={savingTerm}>{t('saveTermDates')}</button>
      </form>

      <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('patternsHeading')}</div>
      {(!patterns || patterns.length === 0) && (
        <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.85rem' }}>{t('patternsEmpty')}</p>
      )}
      {patterns && patterns.length > 0 && (
        <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: '.88rem' }}>
          {patterns.map((pattern) => (
            <li key={pattern.id}>
              {t(WEEKDAY_KEYS[pattern.day_of_week])} {pattern.start_time}–{pattern.end_time}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addPattern} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="v2-field" style={{ margin: 0 }}>
          <label htmlFor="pattern-day">{t('dayOfWeekLabel')}</label>
          <select id="pattern-day" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            {WEEKDAY_KEYS.map((key, index) => (
              <option key={key} value={index}>{t(key)}</option>
            ))}
          </select>
        </div>
        <div className="v2-field" style={{ margin: 0 }}>
          <label htmlFor="pattern-start">{t('startTimeLabel')}</label>
          <input id="pattern-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div className="v2-field" style={{ margin: 0 }}>
          <label htmlFor="pattern-end">{t('endTimeLabel')}</label>
          <input id="pattern-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>
        <button type="submit" className="v2-btn v2-btn-secondary" disabled={addingPattern}>{t('addPattern')}</button>
      </form>

      <button type="button" className="v2-btn v2-btn-primary" onClick={handleGenerate} disabled={generating}>
        {t('generateSessionsCta')}
      </button>
      {generatedMsg && <span style={{ marginLeft: 12, fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>{generatedMsg}</span>}
    </div>
  )
}

function AddSessionForm({ sectionId, onChanged }) {
  const { t } = useI18n()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await createSession(sectionId, new Date(start).toISOString(), new Date(end).toISOString())
      setStart('')
      setEnd('')
      onChanged()
    } catch {
      setError(t('genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="v2-card" style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="v2-field" style={{ margin: 0 }}>
        <label htmlFor="session-start">{t('sessionStartLabel')}</label>
        <input id="session-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
      </div>
      <div className="v2-field" style={{ margin: 0 }}>
        <label htmlFor="session-end">{t('sessionEndLabel')}</label>
        <input id="session-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
      </div>
      <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting}>{t('addSessionSubmit')}</button>
      {error && <p className="v2-field-error" style={{ margin: 0 }}>{error}</p>}
    </form>
  )
}

function SessionsTable({ sessions, onChanged }) {
  const { t } = useI18n()
  const [openingId, setOpeningId] = useState(null)

  async function handleOpen(sessionId, method) {
    setOpeningId(sessionId)
    try {
      await openSession(sessionId, method)
      onChanged()
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <table className="v2-table">
      <thead>
        <tr>
          <th>{t('colDate')}</th>
          <th>{t('colTime')}</th>
          <th>{t('colStatus')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => {
          const status = sessionStatus(session)
          return (
            <tr key={session.id}>
              <td>{new Date(session.scheduled_start).toLocaleDateString()}</td>
              <td className="is-muted">{formatDateTime(session.scheduled_start)} – {formatDateTime(session.scheduled_end)}</td>
              <td>
                <span className={`v2-badge ${status === 'open' ? 'v2-badge-teacher' : status === 'closed' ? 'v2-badge-student' : 'v2-badge-ta'}`}>
                  {t(status === 'open' ? 'statusOpen' : status === 'closed' ? 'statusClosed' : 'statusScheduled')}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                {status === 'scheduled' && (
                  <>
                    <button
                      type="button"
                      className="v2-btn v2-btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '.75rem', marginRight: 6 }}
                      disabled={openingId === session.id}
                      onClick={() => handleOpen(session.id, 'qr')}
                    >
                      {t('openViaQr')}
                    </button>
                    <button
                      type="button"
                      className="v2-btn v2-btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '.75rem' }}
                      disabled={openingId === session.id}
                      onClick={() => handleOpen(session.id, 'emoji')}
                    >
                      {t('openViaEmoji')}
                    </button>
                  </>
                )}
                {status === 'open' && (
                  <Link to={`live/${session.id}`} className="v2-btn v2-btn-primary" style={{ padding: '4px 10px', fontSize: '.75rem' }}>
                    {t('manageAction')}
                  </Link>
                )}
                {status === 'closed' && (
                  <Link to={`live/${session.id}`} style={{ fontSize: '.78rem' }}>
                    {t('viewRosterAction')}
                  </Link>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
