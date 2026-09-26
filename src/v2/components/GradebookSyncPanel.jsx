import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'

const SYNC_STATUSES = ['new', 'changed', 'manual', 'unchanged', 'no_attempt']

// Teacher-triggered gradebook sync: preview every learner, tick hand-edited cells to overwrite
// them, then confirm. The server recomputes on confirm with the same rules as the preview.
// Shared by learning activities and practice assignments (PS-TASK-20260926-789): `loadPlan` and
// `applyPlan` call the owner's own sync endpoints, which return the same plan shape.
// `notLinkedText` and `rulesText` are the owner's own wording (the defaults are the activity's).
export default function GradebookSyncPanel({ linked, loadPlan, applyPlan, onSynced, notLinkedText, rulesText }) {
  const { t } = useI18n()
  const [plan, setPlan] = useState(null)
  const [overwrite, setOverwrite] = useState(() => new Set())
  const [state, setState] = useState('idle') // idle | loading | ready | applying | error
  const [written, setWritten] = useState(null)

  async function loadPreview() {
    setState('loading')
    setWritten(null)
    try {
      setPlan(await loadPlan())
      setOverwrite(new Set())
      setState('ready')
    } catch {
      setState('error')
    }
  }

  async function confirm() {
    setState('applying')
    try {
      const result = await applyPlan([...overwrite])
      setWritten(result.written.length)
      setPlan(await loadPlan())
      setOverwrite(new Set())
      setState('ready')
      onSynced?.()
    } catch {
      setState('error')
    }
  }

  if (!linked) {
    return <div className="v2-notice v2-notice-info" style={{ marginTop: 16 }}>{notLinkedText ?? t('activitySyncNotLinked')}</div>
  }

  const toWrite = plan ? plan.rows.filter((r) => r.status === 'new' || r.status === 'changed' || (r.status === 'manual' && overwrite.has(r.userId))).length : 0
  const points = (value) => (value === null || value === undefined ? '—' : value)

  return (
    <div className="v2-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem', margin: 0 }}>{t('activitySyncHeading')}</h2>
        <button type="button" className="v2-btn v2-btn-secondary" disabled={state === 'loading' || state === 'applying'} onClick={loadPreview}>
          {plan ? t('activitySyncRefresh') : t('activitySyncPreviewCta')}
        </button>
      </div>
      <p className="v2-field-hint">{rulesText ?? t('activitySyncRules')}</p>
      {state === 'error' && <p className="v2-field-error">{t('genericError')}</p>}
      {written !== null && <div className="v2-notice v2-notice-info">{t('activitySyncDone', { n: written })}</div>}
      {plan && (
        <>
          <p className="v2-subtext">
            {t('activitySyncTarget', { name: plan.assignment.name, max: plan.assignment.maxPoints })} ·{' '}
            {SYNC_STATUSES.map((s) => `${t(`activitySyncStatus_${s}`)} ${plan.rows.filter((r) => r.status === s).length}`).join(' · ')}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>{t('activityColLearner')}</th>
                  <th>{t('activitySyncColCurrent')}</th>
                  <th>{t('activitySyncColNew')}</th>
                  <th>{t('activitySyncColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.displayName}{r.studentId && <div className="is-muted">{r.studentId}</div>}</td>
                    <td>{points(r.currentPoints)}</td>
                    <td>{points(r.newPoints)}</td>
                    <td>
                      {r.status === 'manual' ? (
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={overwrite.has(r.userId)}
                            onChange={(e) => {
                              const next = new Set(overwrite)
                              if (e.target.checked) next.add(r.userId)
                              else next.delete(r.userId)
                              setOverwrite(next)
                            }}
                          />
                          {t('activitySyncStatus_manual')} — {t('activitySyncOverwrite')}
                        </label>
                      ) : (
                        t(`activitySyncStatus_${r.status}`)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-primary" disabled={toWrite === 0 || state === 'applying'} onClick={confirm}>
              {t('activitySyncConfirm', { n: toWrite })}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
