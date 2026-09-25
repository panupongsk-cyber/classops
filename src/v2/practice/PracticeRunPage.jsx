import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { answerQuestion, finishAttempt, getAttempt } from './api.js'
import ExamResult from './ExamResult.jsx'
import ExamRun from './ExamRun.jsx'
import QuestionCard from './QuestionCard.jsx'
import useBookmarks from './useBookmarks.js'

// A practice run or quick quiz: one question at a time; after each answer the server says whether
// it was right and which option was; at the end, the score, a per-category tally, and a review.
export default function PracticeRunPage() {
  const { t } = useI18n()
  const { sectionId, attemptId } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [feedback, setFeedback] = useState(null) // { question, selected, correct, answer, next }
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)
  const bookmarks = useBookmarks(sectionId)

  const load = useCallback(async () => {
    try {
      const result = await getAttempt(sectionId, attemptId)
      setData(result)
      setLang((current) => current === 'en' ? result.attempt.lang : current)
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [sectionId, attemptId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  const { attempt } = data
  const isExam = attempt.mode === 'exam'
  const current = feedback?.question ?? data.next
  const hasThai = Boolean(current?.stem?.th || data.review?.some((r) => r.question.stem.th) || data.questions?.some((q) => q.stem.th))

  async function submit() {
    if (!selected || !data.next) return
    setBusy(true)
    try {
      const result = await answerQuestion(sectionId, attemptId, data.next.id, selected)
      setFeedback({ question: data.next, selected, ...result })
    } finally {
      setBusy(false)
    }
  }

  async function next() {
    const upcoming = feedback?.next
    setFeedback(null)
    setSelected(null)
    if (upcoming) {
      setData({ ...data, next: upcoming, attempt: { ...attempt, answeredCount: attempt.answeredCount + 1, correctCount: attempt.correctCount + (feedback.correct ? 1 : 0) } })
    } else {
      await finishAttempt(sectionId, attemptId)
      await load()
    }
  }

  async function finishEarly() {
    await finishAttempt(sectionId, attemptId)
    setFeedback(null)
    await load()
  }

  const answered = attempt.answeredCount + (feedback ? 1 : 0)
  return (
    <div className="v2-content-narrow">
      <Link to={`/v2/sections/${sectionId}/practice`} className="v2-subtext">← {t('practiceBack')}</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, margin: '8px 0', flexWrap: 'wrap' }}>
        <h1 className="v2-h1" style={{ margin: 0 }}>{t(`practiceMode_${attempt.mode}`)}</h1>
        {!isExam && <span className="v2-subtext">{t('practiceProgress', { done: answered, total: attempt.questionCount })}</span>}
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

      {isExam && attempt.status === 'in_progress' && data.questions && (
        <ExamRun sectionId={sectionId} attemptId={attemptId} data={data} lang={lang} onFinished={load} />
      )}
      {isExam && attempt.status === 'in_progress' && !data.questions && (
        <div className="v2-notice v2-notice-info">{t('examInProgressStaff', { done: attempt.answeredCount, total: attempt.questionCount })}</div>
      )}

      {!isExam && current && attempt.status === 'in_progress' && (
        <>
          <QuestionCard question={current} lang={lang} selected={selected} onSelect={setSelected} revealed={feedback ? { selected: feedback.selected, answer: feedback.answer } : null} disabled={busy} bookmarks={bookmarks} />
          {feedback && (
            <div className={`v2-notice ${feedback.correct ? 'v2-notice-info' : 'v2-notice-error'}`}>
              {feedback.correct ? t('practiceCorrect') : t('practiceWrong', { answer: feedback.answer })}
            </div>
          )}
          <div className="v2-btn-row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="v2-btn-sm v2-btn-outline" onClick={finishEarly}>{t('practiceFinishNow')}</button>
            {feedback
              ? <button type="button" className="v2-btn v2-btn-primary" onClick={next}>{feedback.next ? t('practiceNextQuestion') : t('practiceSeeResult')}</button>
              : <button type="button" className="v2-btn v2-btn-primary" disabled={!selected || busy} onClick={submit}>{t('practiceSubmit')}</button>}
          </div>
        </>
      )}

      {data.review && isExam && data.result && <ExamResult attempt={attempt} result={data.result} byCategory={data.byCategory} />}
      {data.review && (
        <>
          {!isExam && <div className="v2-card" style={{ textAlign: 'center', marginBottom: 16 }}>
            <div className="v2-stat-value">{attempt.correctCount}/{attempt.questionCount}</div>
            <p className="v2-subtext">{t('practiceAnsweredOf', { done: attempt.answeredCount, total: attempt.questionCount })}</p>
            <table className="v2-table" style={{ textAlign: 'left' }}>
              <tbody>
                {data.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{c.field} · {c.category}</td>
                    <td className="is-muted" style={{ textAlign: 'right' }}>{c.correct}/{c.answered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="v2-field-hint">{t('practiceCategoryDisclosureHint')}</p>
          </div>}
          <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('practiceReview')}</h2>
          {data.review.map((r) => (
            <QuestionCard key={r.question.id} question={r.question} lang={lang} revealed={{ selected: r.selected, answer: r.question.answer }} flagged={r.flagged} unanswered={r.selected === null} bookmarks={bookmarks} />
          ))}
        </>
      )}
    </div>
  )
}
