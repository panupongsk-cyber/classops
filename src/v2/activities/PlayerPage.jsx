import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { finishAttempt, listActivities, localized, percent, startAttempt, submitResponse } from './api.js'
import ItemView, { emptyAnswer, isComplete } from './ItemView.jsx'

const BLOCKING_ERRORS = ['ACTIVITY_NOT_AVAILABLE', 'ATTEMPT_LIMIT_REACHED', 'ACTIVITY_NOT_FOUND']

/** Server error code -> message; unknown codes get the generic message. */
export function activityErrorText(t, code) {
  const key = `activityError_${code}`
  const text = t(key)
  return text === key ? t('activityError_generic') : text
}

export default function PlayerPage() {
  const { t, lang } = useI18n()
  const { sectionId, activityId } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('loading') // loading | playing | blocked | forbidden | error
  const [blockedCode, setBlockedCode] = useState(null)
  const [title, setTitle] = useState('')
  const [play, setPlay] = useState(null) // { attempt, activity, next, progress }
  const [answer, setAnswer] = useState(null)
  const [feedback, setFeedback] = useState(null) // { itemKey, feedback, lockedItem, lockedAnswer }
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const begin = useCallback(async () => {
    setStatus('loading')
    try {
      const { activities } = await listActivities(sectionId)
      const activity = activities.find((a) => a.id === activityId)
      if (!activity) { setBlockedCode('ACTIVITY_NOT_FOUND'); setStatus('blocked'); return }
      setTitle(localized(activity.title, lang))
      const playLang = activity.languages.includes(lang) ? lang : activity.languages[0]
      const started = await startAttempt(activityId, playLang)
      setPlay(started)
      setAnswer(started.next ? emptyAnswer(started.next) : null)
      setStatus('playing')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else if (err instanceof ApiError && BLOCKING_ERRORS.includes(err.code)) { setBlockedCode(err.code); setStatus('blocked') }
      else setStatus('error')
    }
    // The UI language only picks the attempt language at start; switching it must not restart
    // the attempt, so `lang` is deliberately not a dependency.
  }, [sectionId, activityId])

  useEffect(() => { begin() }, [begin])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!play?.next || !isComplete(play.next, answer)) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await submitResponse(play.attempt.id, play.next.key, answer)
      setFeedback({ feedback: result.feedback, lockedItem: play.next, lockedAnswer: answer })
      setPlay({ ...play, next: result.next, progress: result.progress })
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.code : 'REQUEST_FAILED')
    } finally {
      setSubmitting(false)
    }
  }

  function handleContinue() {
    setFeedback(null)
    setAnswer(play.next ? emptyAnswer(play.next) : null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleFinish() {
    setSubmitting(true)
    try {
      const result = await finishAttempt(play.attempt.id)
      navigate(`/v2/sections/${sectionId}/activities/attempts/${result.attempt.id}`, { replace: true })
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.code : 'REQUEST_FAILED')
      setSubmitting(false)
    }
  }

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={begin} />
  if (status === 'blocked') {
    return (
      <div className="v2-state">
        <p className="v2-state-heading">{activityErrorText(t, blockedCode)}</p>
        <Link to={`/v2/sections/${sectionId}/activities`}>{t('activityBackToList')}</Link>
      </div>
    )
  }

  const { progress } = play
  const stage = feedback ? null : play.activity.stages.find((s) => s.key === play.next?.stage)
  const done = !play.next && !feedback

  return (
    <div className="v2-content-narrow">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <h1 className="v2-h1" style={{ margin: 0 }}>{play.activity.title ?? title}</h1>
        <span className="v2-subtext" aria-live="polite">{t('activityProgress', { done: progress.answered, total: progress.total })}</span>
      </div>
      <div className="v2-progress" aria-hidden="true"><div style={{ width: `${(progress.answered / progress.total) * 100}%` }} /></div>
      {play.resumed && progress.answered > 0 && !feedback && <div className="v2-notice v2-notice-info">{t('activityResumed')}</div>}

      {feedback ? (
        <div className="v2-card">
          <ItemView item={feedback.lockedItem} answer={feedback.lockedAnswer} onAnswerChange={() => {}} locked correct={feedback.feedback.correct} details={feedback.feedback.details} />
          <div className={`v2-feedback ${feedback.feedback.ratio >= 0.999 ? 'is-good' : feedback.feedback.ratio > 0 ? 'is-partial' : 'is-bad'}`} role="status">
            <div className="v2-feedback-score">{t('activityItemScore', { pct: percent(feedback.feedback.ratio) })}</div>
            {feedback.feedback.flags.map((flag) => (
              <div key={flag.key} className="v2-notice v2-notice-error"><strong>{flag.title}</strong><br />{flag.body}</div>
            ))}
            {feedback.feedback.explanation && <p style={{ margin: 0 }}>{feedback.feedback.explanation}</p>}
          </div>
          <div className="v2-btn-row">
            {play.next
              ? <button type="button" className="v2-btn v2-btn-primary" onClick={handleContinue} autoFocus>{t('activityNextItem')}</button>
              : <button type="button" className="v2-btn v2-btn-primary" onClick={handleFinish} disabled={submitting} autoFocus>{t('activityFinish')}</button>}
          </div>
        </div>
      ) : done ? (
        <div className="v2-card">
          <p>{t('activityAllAnswered')}</p>
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-primary" onClick={handleFinish} disabled={submitting}>{t('activityFinish')}</button>
          </div>
        </div>
      ) : (
        <form className="v2-card" onSubmit={handleSubmit}>
          {stage && (
            <div className="v2-stage-header">
              <div className="v2-stage-title">{stage.title}</div>
              {stage.brief && <p className="v2-subtext" style={{ margin: '4px 0 0' }}>{stage.brief}</p>}
              {stage.goal && (
                <p className="v2-subtext" style={{ margin: '6px 0 0' }}>
                  <strong>{t('activityStageGoal')}</strong> {stage.goal}
                </p>
              )}
            </div>
          )}
          <ItemView item={play.next} answer={answer} onAnswerChange={setAnswer} />
          {submitError && <p className="v2-field-error">{activityErrorText(t, submitError)}</p>}
          <div className="v2-btn-row">
            <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting || !isComplete(play.next, answer)}>
              {t('activitySubmitAnswer')}
            </button>
          </div>
        </form>
      )}
      {submitError && feedback && <p className="v2-field-error">{activityErrorText(t, submitError)}</p>}
    </div>
  )
}
