import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { getMostMissed, getPracticeStats } from './api.js'
import QuestionCard from './QuestionCard.jsx'
import useBookmarks from './useBookmarks.js'

// Personal progress in this Section (PS-TASK-20260925-770): accuracy, per-category mastery, the
// mock-exam trend, and the Section's anonymous most-missed questions. Answers from a mock exam
// still in progress are not counted anywhere here (the server excludes them).
const pct = (correct, total) => (total ? `${Math.round((correct / total) * 1000) / 10}%` : '—')

function Trend({ points }) {
  // A small inline chart of mock-exam scores (0–100%), oldest to newest.
  if (points.length < 2) return null
  const w = 280
  const h = 80
  const x = (i) => 8 + (i * (w - 16)) / (points.length - 1)
  const y = (r) => h - 8 - r * (h - 16)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-hidden="true" style={{ maxWidth: w, display: 'block', marginBottom: 8 }}>
      <line x1="8" x2={w - 8} y1={y(0.6)} y2={y(0.6)} stroke="var(--v2-border-strong)" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke="var(--v2-primary)" strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r="3" fill="var(--v2-primary)" />)}
    </svg>
  )
}

export default function PracticeProgressPage() {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const [stats, setStats] = useState(null)
  const [missed, setMissed] = useState(null)
  const [status, setStatus] = useState('loading')
  const [lang, setLang] = useState('en')
  const bookmarks = useBookmarks(sectionId)

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([getPracticeStats(sectionId), getMostMissed(sectionId, { limit: 10 })])
      setStats(s)
      setMissed(m)
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [sectionId])
  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  const { overall, byCategory, examTrend } = stats
  const hasThai = missed.questions.some((m) => m.question.stem.th)
  return (
    <div className="v2-content-narrow">
      <Link to={`/v2/sections/${sectionId}/practice`} className="v2-subtext">← {t('practiceBack')}</Link>
      <h1 className="v2-h1" style={{ margin: '8px 0 14px' }}>{t('progressTitle')}</h1>

      <div className="v2-stats-grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="v2-stat-card">
          <div className="v2-stat-title">{t('progressAccuracy')}</div>
          <div className="v2-stat-value">{pct(overall.correct, overall.answered)}</div>
          <div className="v2-stat-hint">{t('progressAnswered', { correct: overall.correct, answered: overall.answered, questions: overall.questions })}</div>
        </div>
        <div className="v2-stat-card">
          <div className="v2-stat-title">{t('progressMistakes')}</div>
          <div className="v2-stat-value">{stats.mistakeCount}</div>
          <div className="v2-stat-hint">{t('progressMistakesHint')}</div>
        </div>
        <div className="v2-stat-card">
          <div className="v2-stat-title">{t('progressBookmarks')}</div>
          <div className="v2-stat-value">{stats.bookmarkCount}</div>
          <div className="v2-stat-hint">{t('progressBookmarksHint')}</div>
        </div>
      </div>

      <div className="v2-card" style={{ marginBottom: 16 }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('progressByCategory')}</h2>
        {byCategory.length === 0 ? <p className="v2-subtext">{t('progressNoAnswers')}</p> : (
          <div className="v2-mastery">
            {byCategory.map((c) => (
              <div key={`${c.field}-${c.category}`} className="v2-mastery-row">
                <div className="v2-mastery-label">{c.field} · {c.category}</div>
                <div className="v2-mastery-bar" aria-hidden="true"><div style={{ width: `${c.answered ? (c.correct / c.answered) * 100 : 0}%` }} /></div>
                <div className="v2-mastery-value">{pct(c.correct, c.answered)} <span className="is-muted">({c.correct}/{c.answered})</span></div>
              </div>
            ))}
          </div>
        )}
        <p className="v2-field-hint">{t('practiceCategoryDisclosureHint')}</p>
      </div>

      <div className="v2-card" style={{ marginBottom: 16 }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('progressExamTrend')}</h2>
        {examTrend.length === 0 ? <p className="v2-subtext">{t('progressNoExams')}</p> : (
          <>
            <Trend points={examTrend.map((e) => (e.questions ? e.correct / e.questions : 0))} />
            <table className="v2-table">
              <tbody>
                {examTrend.slice().reverse().map((e) => (
                  <tr key={e.attemptId}>
                    <td><Link to={`/v2/sections/${sectionId}/practice/attempts/${e.attemptId}`}>{e.examContentId}</Link></td>
                    <td>{e.correct}/{e.questions} ({pct(e.correct, e.questions)})</td>
                    <td>{e.pass === null ? '' : e.pass ? t('examPassEstimate') : t('examFailEstimate')}{e.finishReason === 'time_up' ? ` · ${t('examTimeUpShort')}` : ''}</td>
                    <td className="is-muted">{new Date(e.finishedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="v2-field-hint">{t('progressTrendHint')}</p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem', margin: 0 }}>{t('mostMissedTitle')}</h2>
        {hasThai && (
          <div className="v2-pill-group" role="radiogroup" aria-label={t('practiceQuestionLanguage')}>
            {['en', 'th'].map((l) => (
              <button key={l} type="button" className={`v2-pill-option ${lang === l ? 'is-selected' : ''}`} onClick={() => setLang(l)}>
                <span className="v2-pill-label">{l === 'en' ? 'English' : 'ไทย'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="v2-subtext">{t('mostMissedHint', { answers: missed.minAnswers, learners: missed.minLearners })}</p>
      {missed.questions.length === 0 ? <p className="v2-subtext">{t('mostMissedEmpty')}</p> : missed.questions.map((m) => (
        <div key={m.question.id}>
          <div className="v2-notice v2-notice-error" style={{ marginBottom: 6 }}>{t('mostMissedRate', { wrong: pct(m.answers - m.correct, m.answers), answers: m.answers })}</div>
          <QuestionCard question={m.question} lang={lang} revealed={{ selected: null, answer: m.question.answer }} bookmarks={bookmarks} />
        </div>
      ))}
    </div>
  )
}
