import { useI18n } from '../i18n/I18nContext.jsx'

// A finished mock exam's score (PS-TASK-20260925-767): total, per field against the pass rule
// where the exam family has one (ITPEC IP: 60% total, 30% per field), and per category.
const pct = (ratio) => `${Math.round(ratio * 1000) / 10}%`

export default function ExamResult({ attempt, result, byCategory }) {
  const { t } = useI18n()
  const hasRule = result.pass !== null
  return (
    <div className="v2-card" style={{ marginBottom: 16 }}>
      {attempt.finishReason === 'time_up' && <div className="v2-notice v2-notice-info">{t('examTimeUpResult')}</div>}
      <div style={{ textAlign: 'center' }}>
        <div className="v2-stat-value">{result.correct}/{result.questions}</div>
        <p className="v2-subtext" style={{ marginBottom: 10 }}>{pct(result.ratio)} · {t('practiceAnsweredOf', { done: attempt.answeredCount, total: attempt.questionCount })}</p>
        {hasRule && (
          <span className={`v2-badge ${result.pass ? 'v2-badge-active' : 'v2-badge-suspended'}`} style={{ fontSize: '.85rem', padding: '6px 14px' }}>
            {result.pass ? t('examPassEstimate') : t('examFailEstimate')}
          </span>
        )}
      </div>

      <table className="v2-table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>{t('examFieldCol')}</th>
            <th style={{ textAlign: 'right' }}>{t('examScoreCol')}</th>
            {hasRule && <th style={{ textAlign: 'right' }}>{t('examFieldMinCol', { min: pct(result.rule.perField) })}</th>}
          </tr>
        </thead>
        <tbody>
          {result.fields.map((f) => (
            <tr key={f.field}>
              <td>{f.field}</td>
              <td style={{ textAlign: 'right' }}>{f.correct}/{f.questions} ({pct(f.ratio)})</td>
              {hasRule && <td style={{ textAlign: 'right' }}>{f.pass ? '✓' : '✗'}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <table className="v2-table" style={{ marginTop: 12 }}>
        <thead><tr><th>{t('examCategoryCol')}</th><th style={{ textAlign: 'right' }}>{t('examScoreCol')}</th></tr></thead>
        <tbody>
          {byCategory.map((c) => (
            <tr key={c.category}>
              <td>{c.field} · {c.category}</td>
              <td className="is-muted" style={{ textAlign: 'right' }}>{c.correct}/{c.questions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="v2-field-hint">
        {hasRule ? t('examRuleNote', { total: pct(result.rule.total), field: pct(result.rule.perField) }) + ' ' : ''}
        {t('practiceCategoryDisclosureHint')}
      </p>
    </div>
  )
}
