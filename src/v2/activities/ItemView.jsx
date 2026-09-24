import { useI18n } from '../i18n/I18nContext.jsx'

// Renders one server-projected item and collects its answer. `answer` is keyed by part key:
//   single_choice  -> option token
//   multi_select   -> [option token]
//   categorize /
//   verdict_matrix -> { rowToken: categoryId }
// `correct` (only after the item is locked, and only when the package reveals answers) has the
// same shape, so the view can mark the right choices.

export function emptyAnswer(item) {
  const answer = {}
  for (const part of item.parts) {
    if (part.type === 'multi_select') answer[part.key] = []
    else if (part.type === 'single_choice') answer[part.key] = null
    else answer[part.key] = {}
  }
  return answer
}

export function isComplete(item, answer) {
  return item.parts.every((part) => {
    const value = answer[part.key]
    if (part.type === 'single_choice') return typeof value === 'string'
    if (part.type === 'multi_select') {
      return value.length >= part.min && (part.max === null || value.length <= part.max)
    }
    return part.rows.every((row) => typeof value[row.token] === 'string')
  })
}

function choiceClass(selected, locked, isCorrect) {
  let name = 'v2-choice'
  if (selected) name += ' is-selected'
  if (locked && isCorrect) name += ' is-correct'
  if (locked && selected && isCorrect === false) name += ' is-wrong'
  return name
}

function ChoicePart({ part, value, onChange, locked, correct }) {
  const { t } = useI18n()
  const multi = part.type === 'multi_select'
  const chosen = multi ? value : value ? [value] : []
  const correctSet = correct === undefined ? null : new Set(multi ? correct : [correct])
  const atMax = multi && part.max !== null && chosen.length >= part.max

  function toggle(token) {
    if (locked) return
    if (!multi) return onChange(token)
    if (chosen.includes(token)) return onChange(chosen.filter((x) => x !== token))
    if (atMax) return
    onChange([...chosen, token])
  }

  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      {multi && (
        <p className="v2-field-hint">
          {part.max === null
            ? t('activityChooseAtLeast', { n: part.min })
            : part.min === part.max
              ? t('activityChooseExactly', { n: part.min })
              : t('activityChooseRange', { min: part.min, max: part.max })}
        </p>
      )}
      <div className="v2-choice-list" role={multi ? 'group' : 'radiogroup'}>
        {part.options.map((option) => {
          const selected = chosen.includes(option.token)
          const isCorrect = correctSet ? correctSet.has(option.token) : undefined
          return (
            <button
              key={option.token}
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={selected}
              className={choiceClass(selected, locked, isCorrect)}
              disabled={locked || (!selected && atMax)}
              onClick={() => toggle(option.token)}
            >
              <span className="v2-choice-mark" aria-hidden="true">{multi ? (selected ? '☑' : '☐') : (selected ? '◉' : '○')}</span>
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RowPart({ part, value, onChange, locked, correct }) {
  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      {part.rows.map((row) => (
        <div key={row.token} className="v2-row-part">
          <div className="v2-row-label">{row.label}</div>
          <div className="v2-pill-group" role="radiogroup" aria-label={row.label}>
            {part.categories.map((category) => {
              const selected = value[row.token] === category.id
              const isCorrect = correct === undefined ? undefined : correct[row.token] === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`v2-pill-option ${selected ? 'is-selected' : ''} ${locked && isCorrect ? 'is-correct' : ''} ${locked && selected && isCorrect === false ? 'is-wrong' : ''}`}
                  disabled={locked}
                  onClick={() => onChange({ ...value, [row.token]: category.id })}
                >
                  <span className="v2-pill-label">{category.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ItemView({ item, answer, onAnswerChange, locked = false, correct }) {
  return (
    <div>
      {item.title && <h2 className="v2-item-title">{item.title}</h2>}
      {item.scenario && <p className="v2-item-scenario">{item.scenario}</p>}
      {item.context && (
        <dl className="v2-item-context">
          {item.context.map((c) => (
            <div key={c.label}><dt>{c.label}</dt><dd>{c.value}</dd></div>
          ))}
        </dl>
      )}
      {item.evidence && (
        <div className="v2-item-evidence">
          {item.evidence.tag && <span className="v2-badge v2-badge-ta">{item.evidence.tag}</span>}
          <pre>{item.evidence.body}</pre>
        </div>
      )}
      {item.parts.map((part) => {
        const props = {
          part,
          value: answer[part.key],
          onChange: (next) => onAnswerChange({ ...answer, [part.key]: next }),
          locked,
          correct: correct ? correct[part.key] : undefined,
        }
        return part.type === 'single_choice' || part.type === 'multi_select'
          ? <ChoicePart key={part.key} {...props} />
          : <RowPart key={part.key} {...props} />
      })}
    </div>
  )
}
