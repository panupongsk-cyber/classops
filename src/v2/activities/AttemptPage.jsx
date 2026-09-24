import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { getAttempt, percent } from './api.js'
import ItemView from './ItemView.jsx'

// Result of one attempt, for its learner or a Section manager. The review (each item with its
// correct answer) is only returned by the server to the learner, and only when the package
// reveals answers.
export default function AttemptPage() {
  const { t } = useI18n()
  const { sectionId, attemptId } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setData(await getAttempt(attemptId))
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [attemptId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  const { attempt, activity, result, review } = data
  const answeredCount = data.responses.length

  return (
    <div className="v2-content-narrow">
      <Link to={`/v2/sections/${sectionId}/activities`} className="v2-subtext">← {t('activityBackToList')}</Link>
      <h1 className="v2-h1" style={{ marginTop: 8 }}>{activity.title}</h1>
      <p className="v2-subtext">
        {t('activityAttemptLabel', { n: attempt.attemptNo })} · {attempt.finishedAt
          ? t('activityFinishedAt', { when: new Date(attempt.finishedAt).toLocaleString() })
          : t('activityInProgress')}
      </p>

      {result ? (
        <div className="v2-card" style={{ marginBottom: 20, textAlign: 'center' }}>
          {result.band?.badge && <div style={{ fontSize: '2.5rem' }} aria-hidden="true">{result.band.badge}</div>}
          <div className="v2-stat-value">{percent(result.scoreRatio)}</div>
          {result.band?.title && <div style={{ fontWeight: 600, marginTop: 4 }}>{result.band.title}</div>}
          {result.band?.description && <p className="v2-subtext" style={{ marginTop: 8 }}>{result.band.description}</p>}
          <p className="v2-subtext">{t('activityAnsweredOf', { done: result.answered, total: result.total })}</p>
          {result.stageResults && (
            <table className="v2-table" style={{ marginTop: 12, textAlign: 'left' }}>
              <tbody>
                {activity.stages.map((stage) => (
                  <tr key={stage.key}>
                    <td>{stage.title}</td>
                    <td className="is-muted" style={{ textAlign: 'right' }}>{percent(result.stageResults[stage.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="v2-field-hint" style={{ marginTop: 12 }}>{t('activityEvidenceNote')}</p>
        </div>
      ) : (
        <div className="v2-notice v2-notice-info">{t('activityNotFinished', { done: answeredCount })}</div>
      )}

      {review && review.length > 0 && (
        <>
          <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('activityReviewHeading')}</h2>
          {review.map((entry) => {
            const response = data.responses.find((r) => r.itemKey === entry.item.key)
            return (
              <div key={entry.item.key} className="v2-card" style={{ marginBottom: 16 }}>
                <ItemView item={entry.item} answer={blankAnswer(entry.item)} onAnswerChange={() => {}} locked correct={entry.correct} />
                <div className="v2-feedback" role="note">
                  {response && <div className="v2-feedback-score">{t('activityItemScore', { pct: percent(response.ratio) })}</div>}
                  {entry.explanation && <p style={{ margin: 0 }}>{entry.explanation}</p>}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// The review shows the correct answers; the learner's own choices are not echoed back.
function blankAnswer(item) {
  const answer = {}
  for (const part of item.parts) answer[part.key] = part.type === 'multi_select' ? [] : part.type === 'single_choice' ? null : {}
  return answer
}
