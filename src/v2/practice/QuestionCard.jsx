import { useI18n } from '../i18n/I18nContext.jsx'
import { pick } from './api.js'

// One exam question. `revealed` = { selected, answer } after answering (or browse mode's answer);
// the key is never known here before that. Figures come from the authenticated figure route.
export default function QuestionCard({ question, lang, selected, onSelect, revealed, disabled }) {
  const { t } = useI18n()
  const figure = (lang === 'th' && question.figure?.th) || question.figure?.en
  return (
    <div className="v2-card" style={{ marginBottom: 14 }}>
      <div className="v2-subtext" style={{ marginBottom: 6 }}>
        {question.examContentId} · Q{question.seq} · {question.category}{' '}
        <span className="v2-badge v2-badge-ta" title={t('practiceCategoryDisclosureHint')}>{t('practiceCategoryDisclosure')}</span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{pick(question.stem, lang)}</p>
      {figure && <img src={figure} alt={t('practiceFigureAlt', { n: question.seq })} style={{ maxWidth: '100%', marginBottom: 12, border: '1px solid var(--v2-border)', borderRadius: 8 }} />}
      <div className="v2-choice-list" role="radiogroup">
        {question.options.map((o) => {
          const isSelected = (revealed?.selected ?? selected) === o.label
          const isAnswer = revealed && revealed.answer === o.label
          const wrong = revealed && isSelected && !isAnswer
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`v2-choice ${isSelected ? 'is-selected' : ''} ${isAnswer ? 'is-correct' : ''} ${wrong ? 'is-wrong' : ''}`}
              disabled={disabled || Boolean(revealed)}
              onClick={() => onSelect?.(o.label)}
            >
              <span className="v2-choice-mark" aria-hidden="true">{o.label})</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{pick(o.text, lang)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
