import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../auth/api.js'
import { useI18n } from '../i18n/I18nContext.jsx'
import { answerQuestion, finishAttempt, getAttempt, setFlag } from './api.js'
import QuestionCard from './QuestionCard.jsx'

// A running mock exam (PS-TASK-20260925-767): the whole paper, no feedback, changeable answers
// and flags. The deadline is the server's; this clock only displays it, corrected for the
// difference between this device's clock and the server's.
function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export default function ExamRun({ sectionId, attemptId, data, lang, onFinished }) {
  const { t } = useI18n()
  const questions = data.questions
  const [index, setIndex] = useState(() => {
    // Resume on the first unanswered question.
    const first = questions.findIndex((q) => !data.selections[q.id])
    return first === -1 ? 0 : first
  })
  const [selections, setSelections] = useState(data.selections)
  const [flagged, setFlagged] = useState(new Set(data.flagged))
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [timeUp, setTimeUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const clockOffset = useRef(new Date(data.serverNow).getTime() - Date.now())
  // Saves run one at a time, in tap order, so the server ends up with the last choice on screen;
  // submitting waits for the chain, so a tap just before "Submit" still counts.
  const saveChain = useRef(Promise.resolve())
  const queue = (task) => {
    const run = saveChain.current.then(task)
    saveChain.current = run.catch(() => {})
    return run
  }
  const deadline = data.attempt.deadlineAt ? new Date(data.attempt.deadlineAt).getTime() : null
  const [now, setNow] = useState(() => Date.now() + clockOffset.current)

  useEffect(() => {
    if (!deadline) return undefined
    const timer = setInterval(() => setNow(Date.now() + clockOffset.current), 1000)
    return () => clearInterval(timer)
  }, [deadline])

  const remaining = deadline ? deadline - now : null
  useEffect(() => {
    if (remaining === null || remaining > 0 || timeUp) return
    setTimeUp(true)
  }, [remaining, timeUp])

  // At the deadline the server finishes the attempt (after a short grace); wait, then reload.
  useEffect(() => {
    if (!timeUp) return undefined
    let cancelled = false
    const poll = async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const result = await getAttempt(sectionId, attemptId)
          if (result.attempt.status === 'finished') { if (!cancelled) onFinished(); return }
        } catch { /* keep polling */ }
      }
    }
    poll()
    return () => { cancelled = true }
  }, [timeUp, sectionId, attemptId, onFinished])

  const question = questions[index]
  const answeredCount = useMemo(() => questions.filter((q) => selections[q.id]).length, [questions, selections])
  const unanswered = questions.length - answeredCount

  async function choose(label) {
    if (timeUp) return
    const questionId = question.id
    const next = (selections[questionId] ?? null) === label ? null : label // tapping the chosen option again clears it
    setSelections((s) => ({ ...s, [questionId]: next }))
    setError(null)
    try {
      await queue(() => answerQuestion(sectionId, attemptId, questionId, next))
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'TIME_UP' || err.code === 'ATTEMPT_FINISHED')) { setTimeUp(true); return }
      setError(t('examSaveFailed'))
      // Show what the server actually holds rather than guessing what to roll back to.
      try {
        const fresh = await getAttempt(sectionId, attemptId)
        if (fresh.selections) setSelections(fresh.selections)
      } catch { /* keep the screen as is; the error is shown */ }
    }
  }

  async function toggleFlag() {
    const on = !flagged.has(question.id)
    try {
      const result = await queue(() => setFlag(sectionId, attemptId, question.id, on))
      setFlagged(new Set(result.flagged))
    } catch {
      setError(t('examSaveFailed'))
    }
  }

  async function submit() {
    setBusy(true)
    try {
      await saveChain.current
      await finishAttempt(sectionId, attemptId)
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'ATTEMPT_FINISHED')) { setError(t('examSaveFailed')); setBusy(false); return }
    }
    onFinished()
  }

  const clockClass = remaining === null ? '' : remaining < 5 * 60000 ? 'is-danger' : remaining < 10 * 60000 ? 'is-warning' : ''
  return (
    <>
      <div className="v2-exam-bar">
        <span className={`v2-exam-clock ${clockClass}`} role="timer" aria-live="off">
          {remaining === null ? t('examUntimed') : t('examTimeLeft', { time: formatRemaining(remaining) })}
        </span>
        <span className="v2-subtext" style={{ margin: 0 }}>{t('practiceProgress', { done: answeredCount, total: questions.length })}</span>
        <button type="button" className="v2-btn-sm v2-btn-outline" disabled={timeUp} onClick={() => setConfirming(true)}>{t('examSubmit')}</button>
      </div>

      {timeUp && <div className="v2-notice v2-notice-error">{t('examTimeUpNotice')}</div>}
      {error && <div className="v2-notice v2-notice-error">{error}</div>}

      <details className="v2-exam-palette-wrap" open={typeof window !== 'undefined' && window.innerWidth > 640}>
        <summary>{t('examPalette', { answered: answeredCount, total: questions.length, flagged: flagged.size })}</summary>
        <div className="v2-exam-palette" role="list">
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              role="listitem"
              className={`v2-exam-cell ${selections[q.id] ? 'is-answered' : ''} ${flagged.has(q.id) ? 'is-flagged' : ''} ${i === index ? 'is-current' : ''}`}
              aria-label={t('examCellLabel', { n: q.seq })}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => setIndex(i)}
            >
              {q.seq}
            </button>
          ))}
        </div>
      </details>

      <QuestionCard question={question} lang={lang} selected={selections[question.id] ?? null} onSelect={choose} disabled={timeUp} />

      <div className="v2-control-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="v2-btn-sm v2-btn-outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>← {t('practicePrev')}</button>
        <button type="button" className={`v2-btn-sm ${flagged.has(question.id) ? 'v2-btn-flag-on' : 'v2-btn-outline'}`} aria-pressed={flagged.has(question.id)} disabled={timeUp} onClick={toggleFlag}>
          ⚑ {flagged.has(question.id) ? t('examUnflag') : t('examFlag')}
        </button>
        {index < questions.length - 1
          ? <button type="button" className="v2-btn-sm v2-btn-outline" onClick={() => setIndex(index + 1)}>{t('practiceNext')} →</button>
          : <button type="button" className="v2-btn v2-btn-primary" disabled={timeUp} onClick={() => setConfirming(true)}>{t('examSubmit')}</button>}
      </div>

      {confirming && (
        <div className="v2-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="exam-confirm-title">
          <div className="v2-modal" style={{ maxWidth: 420 }}>
            <h2 id="exam-confirm-title" className="v2-h1" style={{ fontSize: '1.1rem' }}>{t('examConfirmTitle')}</h2>
            <p className="v2-subtext">{t('examConfirmBody', { unanswered, flagged: flagged.size })}</p>
            <div className="v2-btn-row">
              <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setConfirming(false)}>{t('examKeepGoing')}</button>
              <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={submit}>{t('examSubmitConfirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
