import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { EmptyState, ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { createCodeExercise, listCodeExercises } from './api.js'
import CodeEditor from './CodeEditor.jsx'
import { codeErrorText, emptyTest, scoreText, STATUS_KEYS, toPayloadTests } from './helpers.js'

export default function CodeExercisesPage() {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const [status, setStatus] = useState('loading')
  const [exercises, setExercises] = useState([])
  const [canManage, setCanManage] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await listCodeExercises(sectionId)
      setExercises(result.exercises)
      setCanManage(Boolean(result.canManage))
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [sectionId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  return (
    <div>
      <h1 className="v2-h1">{t('navCode')}</h1>
      <p className="v2-subtext">{canManage ? t('codeManagerSubtext') : t('codeStudentSubtext')}</p>
      {canManage && <CreateExerciseForm sectionId={sectionId} onCreated={load} />}
      {exercises.length === 0 ? (
        <EmptyState heading={t('codeEmpty')} />
      ) : (
        <table className="v2-table">
          <thead>
            <tr>
              <th>{t('codeColTitle')}</th>
              <th>{t('codeColStatus')}</th>
              <th>{t('codeColTests')}</th>
              <th>{canManage ? t('codeColSubmissions') : t('codeColMyScore')}</th>
            </tr>
          </thead>
          <tbody>
            {exercises.map((exercise) => (
              <tr key={exercise.id}>
                <td><Link to={`/v2/sections/${sectionId}/code/${exercise.id}`}>{exercise.title}</Link></td>
                <td>{t(STATUS_KEYS[exercise.status])}</td>
                <td>{exercise.test_count}</td>
                <td className="is-muted">
                  {canManage
                    ? exercise.submission_count
                    : exercise.my_submitted_at ? scoreText(exercise.my_passed_count, exercise.my_total_count) : t('codeNotSubmitted')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CreateExerciseForm({ sectionId, onCreated }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [starter, setStarter] = useState('')
  const [tests, setTests] = useState([emptyTest()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function setTest(index, field, value) {
    setTests((current) => current.map((test, i) => (i === index ? { ...test, [field]: value } : test)))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createCodeExercise(sectionId, { title: title.trim(), prompt, starter_code: starter, tests: toPayloadTests(tests) })
      setTitle(''); setPrompt(''); setStarter(''); setTests([emptyTest()]); setOpen(false)
      await onCreated()
    } catch (err) {
      setError(codeErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return <div className="v2-btn-row" style={{ justifyContent: 'flex-start', marginBottom: 16 }}><button type="button" className="v2-btn v2-btn-primary" onClick={() => setOpen(true)}>{t('codeCreate')}</button></div>
  }
  return (
    <form className="v2-card" onSubmit={submit} style={{ marginBottom: 20 }}>
      <label className="v2-field"><span>{t('codeFieldTitle')}</span><input value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="v2-field"><span>{t('codeFieldPrompt')}</span><textarea value={prompt} rows={4} maxLength={10000} onChange={(e) => setPrompt(e.target.value)} /></label>
      <div className="v2-field"><span>{t('codeFieldStarter')}</span><CodeEditor label={t('codeFieldStarter')} value={starter} onChange={setStarter} rows={8} /></div>
      <p className="v2-field-hint">{t('codeTestsHint')}</p>
      {tests.map((test, index) => (
        <fieldset key={index} className="v2-code-test">
          <legend>{t('codeTestN', { n: index + 1 })}</legend>
          <label className="v2-field"><span>{t('codeFieldTestName')}</span><input value={test.name} maxLength={200} onChange={(e) => setTest(index, 'name', e.target.value)} /></label>
          <label className="v2-field"><span>{t('codeFieldStdin')}</span><textarea className="v2-code-io" value={test.stdin} rows={2} maxLength={4000} spellCheck={false} onChange={(e) => setTest(index, 'stdin', e.target.value)} /></label>
          <label className="v2-field"><span>{t('codeFieldExpected')}</span><textarea className="v2-code-io" value={test.expected_stdout} rows={2} maxLength={4000} spellCheck={false} onChange={(e) => setTest(index, 'expected_stdout', e.target.value)} /></label>
          {tests.length > 1 && <button type="button" className="v2-btn-sm" onClick={() => setTests((c) => c.filter((_, i) => i !== index))}>{t('codeRemoveTest')}</button>}
        </fieldset>
      ))}
      {tests.length < 10 && <button type="button" className="v2-btn-sm" onClick={() => setTests((c) => [...c, emptyTest()])}>{t('codeAddTest')}</button>}
      {error && <p className="v2-field-error" role="alert">{error}</p>}
      <div className="v2-btn-row">
        <button type="button" className="v2-btn v2-btn-secondary" onClick={() => setOpen(false)}>{t('cancel')}</button>
        <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !title.trim()}>{t('codeSaveDraft')}</button>
      </div>
    </form>
  )
}
