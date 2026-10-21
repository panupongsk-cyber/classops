import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { getCodeExercise, listCodeSubmissions, runCodeExercise, submitCodeExercise, updateCodeExercise } from './api.js'
import CodeEditor from './CodeEditor.jsx'
import { codeErrorText, scoreText, STATUS_KEYS } from './helpers.js'

export default function CodeExercisePage() {
  const { t } = useI18n()
  const { sectionId, exerciseId } = useParams()
  const [status, setStatus] = useState('loading')
  const [exercise, setExercise] = useState(null)
  const [canManage, setCanManage] = useState(false)
  const [mySubmission, setMySubmission] = useState(null)
  const [code, setCode] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await getCodeExercise(exerciseId)
      setExercise(result.exercise)
      setCanManage(Boolean(result.canManage))
      setMySubmission(result.mySubmission)
      setCode(result.mySubmission?.code ?? result.exercise.starter_code)
      if (result.canManage) setSubmissions((await listCodeSubmissions(exerciseId)).submissions)
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else if (err instanceof ApiError && err.status === 404) setStatus('notFound')
      else setStatus('error')
    }
  }, [exerciseId])

  useEffect(() => { load() }, [load])

  async function act(kind) {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'run') {
        setOutcome(await runCodeExercise(exerciseId, code))
      } else {
        const result = await submitCodeExercise(exerciseId, code)
        setOutcome(result)
        setMySubmission(result.submission)
      }
    } catch (err) {
      setError(codeErrorText(t, err))
    } finally {
      setBusy(null)
    }
  }

  async function setExerciseStatus(next) {
    setError(null)
    try {
      setExercise((await updateCodeExercise(exerciseId, { status: next })).exercise)
    } catch (err) {
      setError(codeErrorText(t, err))
    }
  }

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'notFound') return <div className="v2-notice v2-notice-error">{t('codeNotFound')}</div>
  if (status === 'error') return <RetryableError onRetry={load} />

  const canRun = canManage || exercise.status === 'open'
  const canSubmit = exercise.status === 'open'

  return (
    <div>
      <p className="v2-subtext"><Link to={`/v2/sections/${sectionId}/code`}>← {t('navCode')}</Link></p>
      <h1 className="v2-h1">{exercise.title}</h1>
      <p className="v2-subtext">{t(STATUS_KEYS[exercise.status])}{mySubmission ? ` · ${t('codeMyLatest')}: ${scoreText(mySubmission.passed_count, mySubmission.total_count)}` : ''}</p>
      {canManage && (
        <div className="v2-btn-row" style={{ justifyContent: 'flex-start', marginBottom: 16 }}>
          {['draft', 'open', 'closed'].filter((s) => s !== exercise.status).map((s) => (
            <button key={s} type="button" className="v2-btn-sm" onClick={() => setExerciseStatus(s)}>{t(`codeSetStatus_${s}`)}</button>
          ))}
        </div>
      )}
      {exercise.prompt && <div className="v2-card v2-code-prompt">{exercise.prompt}</div>}

      <h2 className="v2-h1 v2-code-h2">{t('codeVisibleTests')}</h2>
      <table className="v2-table" style={{ marginBottom: 20 }}>
        <thead><tr><th>#</th><th>{t('codeFieldStdin')}</th><th>{t('codeFieldExpected')}</th></tr></thead>
        <tbody>
          {exercise.tests.map((test, index) => (
            <tr key={index}>
              <td>{test.name || index + 1}</td>
              <td><pre className="v2-code-output">{test.stdin}</pre></td>
              <td><pre className="v2-code-output">{test.expected_stdout}</pre></td>
            </tr>
          ))}
        </tbody>
      </table>

      {exercise.status === 'closed' && !canManage && <div className="v2-notice v2-notice-info">{t('codeClosedNotice')}</div>}
      <CodeEditor label={t('codeEditorLabel')} value={code} onChange={setCode} readOnly={!canRun} />
      <div className="v2-btn-row" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
        <button type="button" className="v2-btn v2-btn-secondary" disabled={!canRun || busy !== null} onClick={() => act('run')}>{busy === 'run' ? t('codeRunning') : t('codeRun')}</button>
        {canSubmit && <button type="button" className="v2-btn v2-btn-primary" disabled={busy !== null} onClick={() => act('submit')}>{busy === 'submit' ? t('codeRunning') : t('codeSubmit')}</button>}
      </div>
      {error && <div className="v2-notice v2-notice-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {outcome && <TestResults outcome={outcome} />}

      {canManage && (
        <>
          <h2 className="v2-h1 v2-code-h2" style={{ marginTop: 28 }}>{t('codeSubmissionsHeading')}</h2>
          {submissions.length === 0 ? <p className="v2-subtext">{t('codeNoSubmissions')}</p> : (
            <table className="v2-table">
              <thead><tr><th>{t('codeColStudent')}</th><th>{t('codeColScore')}</th><th>{t('codeColSubmittedAt')}</th><th /></tr></thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.user_id}>
                    <td>{s.display_name}<br /><span className="is-muted">{s.email}</span></td>
                    <td>{scoreText(s.passed_count, s.total_count)}</td>
                    <td className="is-muted">{new Date(s.submitted_at).toLocaleString()}</td>
                    <td><button type="button" className="v2-btn-sm" onClick={() => setViewing(viewing?.user_id === s.user_id ? null : s)}>{t('codeViewCode')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {viewing && (
            <div className="v2-card" style={{ marginTop: 14 }}>
              <strong>{viewing.display_name}</strong>
              <pre className="v2-code-output">{viewing.code}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function TestResults({ outcome }) {
  const { t } = useI18n()
  return (
    <div className="v2-card" style={{ marginTop: 14 }}>
      <strong>{t('codePassedSummary', { passed: outcome.passedCount, total: outcome.totalCount })}</strong>
      {outcome.results.map((result, index) => (
        <div key={index} className={`v2-code-result ${result.passed ? 'is-pass' : 'is-fail'}`}>
          <div>
            {result.name || t('codeTestN', { n: index + 1 })}: {' '}
            {!result.ran ? t('codeResultNotRun') : result.timedOut ? t('codeResultTimedOut') : result.passed ? t('codeResultPass') : t('codeResultFail')}
          </div>
          {result.ran && result.stdout && <pre className="v2-code-output">{result.stdout}</pre>}
          {result.ran && result.stderr && <pre className="v2-code-output v2-code-stderr">{result.stderr}</pre>}
        </div>
      ))}
    </div>
  )
}
