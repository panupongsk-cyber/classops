import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { EmptyState, ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { browseQuestions, getPracticeStats, listAttempts, listExams, setPracticeEnabled, startAttempt } from './api.js'
import QuestionCard from './QuestionCard.jsx'
import useBookmarks from './useBookmarks.js'

// Exam practice home for a Section: enable (staff), pick an exam, then Practice, Quick Quiz, or
// Browse; plus the caller's own history. Question text is English with a Thai toggle where the
// session has the Thai-edition text.
export default function PracticePage() {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [status, setStatus] = useState('loading')
  const [examId, setExamId] = useState('')
  const [category, setCategory] = useState('')
  const [count, setCount] = useState(10)
  const [timed, setTimed] = useState(true)
  const [source, setSource] = useState('all')
  const [counts, setCounts] = useState(null) // { mistakeCount }
  const bookmarks = useBookmarks(sectionId)
  const [qLang, setQLang] = useState('en')
  const [browse, setBrowse] = useState(null) // { total, offset, questions }
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await listExams(sectionId)
      setData(result)
      setExamId((current) => current || result.exams[0]?.id || '')
      listAttempts(sectionId).then((r) => setHistory(r.attempts)).catch(() => setHistory([]))
      getPracticeStats(sectionId).then((r) => setCounts({ mistakeCount: r.mistakeCount })).catch(() => setCounts(null))
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PRACTICE_NOT_ENABLED') setStatus('disabled')
      else setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [sectionId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'disabled') return <EmptyState icon="📘" heading={t('practiceDisabledHeading')} body={t('practiceDisabledBody')} />
  if (status === 'error') return <RetryableError onRetry={load} />

  const exam = data.exams.find((e) => e.id === examId)
  const runningExam = history.find((h) => h.mode === 'exam' && h.status === 'in_progress')
  const categories = exam?.categories ?? data.exams[0]?.categories ?? []
  const hasThai = exam?.languages?.includes('th')

  async function start(mode) {
    setError(null)
    try {
      // Bookmarks and mistakes are drawn from every session, matching the counts shown for them.
      const quizExam = mode === 'quiz' && (examId === 'all' || source !== 'all') ? null : examId
      const payload = { mode, lang: qLang, category: category || null, examId: quizExam, count: Number(count), ...(mode === 'exam' ? { timed } : {}), ...(mode === 'quiz' ? { source } : {}) }
      const result = await startAttempt(sectionId, payload)
      navigate(`/v2/sections/${sectionId}/practice/attempts/${result.attemptId}`)
    } catch (err) {
      setError(err instanceof ApiError ? t(`practiceError_${err.code}`) : t('genericError'))
    }
  }

  async function loadBrowse(offset = 0) {
    if (!exam) return
    setBrowse(await browseQuestions(sectionId, exam.id, { category: category || undefined, offset, limit: 10 }))
  }

  async function toggle() {
    await setPracticeEnabled(sectionId, !data.enabled)
    await load()
  }

  return (
    <div className="v2-content-narrow">
      <h1 className="v2-h1">{t('practiceHeading')}</h1>
      {data.canManage && (
        <div className={`v2-notice ${data.enabled ? 'v2-notice-info' : 'v2-notice-error'}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{data.enabled ? t('practiceEnabledForStudents') : t('practiceDisabledForStudents')}</span>
          <button type="button" className="v2-btn-sm v2-btn-outline" onClick={toggle}>{data.enabled ? t('practiceDisable') : t('practiceEnable')}</button>
        </div>
      )}
      {data.exams.length === 0 ? (
        <EmptyState icon="📭" heading={t('practiceNoExams')} body="" />
      ) : (
        <div className="v2-card" style={{ marginBottom: 16 }}>
          <label className="v2-field">
            <span>{t('practiceExamLabel')}</span>
            <select value={examId} onChange={(e) => { setExamId(e.target.value); setBrowse(null) }}>
              {data.exams.map((e) => <option key={e.id} value={e.id}>{e.title}{e.languages.includes('th') ? ' · TH' : ''}</option>)}
              <option value="all">{t('practiceAllExams')}</option>
            </select>
          </label>
          <label className="v2-field">
            <span>{t('practiceCategoryLabel')} <span className="v2-badge v2-badge-ta">{t('practiceCategoryDisclosure')}</span></span>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setBrowse(null) }}>
              <option value="">{t('practiceAllCategories')}</option>
              {categories.map((c) => <option key={c.name} value={c.name}>{c.field} · {c.name}</option>)}
            </select>
          </label>
          {hasThai && (
            <label className="v2-inline-field" style={{ marginBottom: 14 }}>
              {t('practiceQuestionLanguage')}
              <select value={qLang} onChange={(e) => setQLang(e.target.value)}>
                <option value="en">English</option>
                <option value="th">ไทย</option>
              </select>
            </label>
          )}
          <div className="v2-control-row">
            <button type="button" className="v2-btn v2-btn-primary" disabled={examId === 'all'} onClick={() => start('practice')}>{t('practiceStartPractice')}</button>
            <span className="v2-control-row" style={{ gap: 8 }}>
              <button type="button" className="v2-btn v2-btn-secondary" onClick={() => start('quiz')}>{t('practiceStartQuiz')}</button>
              <input type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 72 }} aria-label={t('practiceQuizCount')} />
              <span className="v2-inline-field">{t('practiceQuestionsUnit')}</span>
              <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={t('quizSourceLabel')}>
                <option value="all">{t('quizSourceAll')}</option>
                <option value="bookmarks">{t('quizSourceBookmarks', { n: bookmarks.size })}</option>
                <option value="mistakes">{t('quizSourceMistakes', { n: counts?.mistakeCount ?? '…' })}</option>
              </select>
            </span>
            <button type="button" className="v2-btn v2-btn-secondary" disabled={examId === 'all'} onClick={() => loadBrowse(0)}>{t('practiceBrowse')}</button>
          </div>
          <div className="v2-exam-start">
            <div style={{ fontWeight: 600 }}>{t('examStartHeading')}</div>
            <p className="v2-field-hint" style={{ marginTop: 2 }}>{t('examStartHint')}</p>
            {runningExam ? (
              <Link to={`/v2/sections/${sectionId}/practice/attempts/${runningExam.id}`} className="v2-btn v2-btn-primary">{t('examResume')}</Link>
            ) : (
              <div className="v2-control-row">
                <button type="button" className="v2-btn v2-btn-primary" disabled={examId === 'all'} onClick={() => start('exam')}>{t('examStart')}</button>
                {exam?.time_limit_minutes ? (
                  <label className="v2-inline-field">
                    <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
                    {t('examTimedLabel', { minutes: exam.time_limit_minutes })}
                  </label>
                ) : exam && <span className="v2-inline-field">{t('examUntimed')}</span>}
              </div>
            )}
          </div>
          {error && <p className="v2-field-error">{error}</p>}
          {exam && (
            <p className="v2-field-hint" style={{ marginBottom: 0 }}>
              {exam.attribution}{exam.translation_note ? ` ${t('practiceTranslationNote')}` : ''}
            </p>
          )}
        </div>
      )}

      {browse && (
        <div style={{ marginBottom: 16 }}>
          <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('practiceBrowseHeading', { from: browse.offset + 1, to: browse.offset + browse.questions.length, total: browse.total })}</h2>
          {browse.questions.map((q) => <QuestionCard key={q.id} question={q} lang={qLang} revealed={{ selected: null, answer: q.answer }} bookmarks={bookmarks} />)}
          <div className="v2-btn-row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="v2-btn-sm v2-btn-outline" disabled={browse.offset === 0} onClick={() => loadBrowse(Math.max(0, browse.offset - 10))}>{t('practicePrev')}</button>
            <button type="button" className="v2-btn-sm v2-btn-outline" disabled={browse.offset + browse.questions.length >= browse.total} onClick={() => loadBrowse(browse.offset + 10)}>{t('practiceNext')}</button>
          </div>
        </div>
      )}

      <Link to={`/v2/sections/${sectionId}/practice/progress`} className="v2-card v2-activities-link" style={{ marginBottom: 16 }}>
        <span aria-hidden="true">📈</span>
        <span>
          <strong>{t('progressTitle')}</strong>
          <p className="v2-subtext">{t('progressLinkHint')}</p>
        </span>
        <span aria-hidden="true">→</span>
      </Link>

      <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('practiceHistory')}</h2>
      {history.length === 0 ? (
        <p className="v2-subtext">{t('practiceNoHistory')}</p>
      ) : (
        <table className="v2-table">
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td><Link to={`/v2/sections/${sectionId}/practice/attempts/${h.id}`}>{t(`practiceMode_${h.mode}`)}</Link></td>
                <td className="is-muted">{h.exam_title ?? t('practiceAllExamsShort')}{h.category ? ` · ${h.category}` : ''}</td>
                <td>{h.status === 'finished' ? `${h.correct_count}/${h.question_count}` : `${h.answered_count}/${h.question_count} …`}{h.finish_reason === 'time_up' ? ` · ${t('examTimeUpShort')}` : ''}</td>
                <td className="is-muted">{new Date(h.started_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
