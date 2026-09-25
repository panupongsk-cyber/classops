import { useI18n } from '../i18n/I18nContext.jsx'

// Renders one server-projected item and collects its answer. `answer` is keyed by part key:
//   single_choice  -> option token
//   multi_select   -> [option token]
//   ordering       -> [option token] in the learner's order (complete when every step is placed)
//   categorize /
//   verdict_matrix -> { rowToken: categoryId }
//   select_then_tag -> { selected: [option token], tags: { optionToken: tagId } } (every pick tagged)
//   matrix_multi   -> { rowToken: { dimensionKey: [optionId] } } (every row, every dimension)
// `correct` (only after the item is locked, and only when the package reveals answers) has the
// same shape, so the view can mark the right choices.

export function emptyAnswer(item) {
  const answer = {}
  for (const part of item.parts) {
    if (part.type === 'multi_select' || part.type === 'ordering') answer[part.key] = []
    else if (part.type === 'single_choice') answer[part.key] = null
    else if (part.type === 'select_then_tag') answer[part.key] = { selected: [], tags: {} }
    else answer[part.key] = {}
  }
  return answer
}

export function isComplete(item, answer) {
  return item.parts.every((part) => {
    const value = answer[part.key]
    if (part.type === 'single_choice') return typeof value === 'string'
    if (part.type === 'ordering') return value.length === part.options.length
    if (part.type === 'multi_select') {
      return value.length >= part.min && (part.max === null || value.length <= part.max)
    }
    if (part.type === 'select_then_tag') {
      const n = value.selected.length
      return n >= part.min && (part.max === null || n <= part.max) && value.selected.every((token) => typeof value.tags[token] === 'string')
    }
    if (part.type === 'matrix_multi') {
      return part.rows.every((row) => part.dimensions.every((d) => (value[row.token]?.[d.key] ?? []).length > 0))
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

function OrderingPart({ part, value, onChange, locked, correct }) {
  const { t } = useI18n()
  const labelOf = new Map(part.options.map((o) => [o.token, o.label]))
  const remaining = part.options.filter((o) => !value.includes(o.token))
  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      <p className="v2-field-hint">{t('activityOrderHint')}</p>
      <ol className="v2-order-list" aria-label={t('activityOrderYours')}>
        {value.map((token, i) => {
          const isCorrect = correct === undefined ? undefined : correct[i] === token
          return (
            <li key={token} className={`v2-choice ${locked && isCorrect ? 'is-correct' : ''} ${locked && isCorrect === false ? 'is-wrong' : ''}`}>
              <span className="v2-choice-mark" aria-hidden="true">{i + 1}.</span>
              <span>{labelOf.get(token)}</span>
            </li>
          )
        })}
      </ol>
      {!locked && (
        <>
          <div className="v2-choice-list">
            {remaining.map((o) => (
              <button key={o.token} type="button" className="v2-choice" onClick={() => onChange([...value, o.token])}>
                <span className="v2-choice-mark" aria-hidden="true">＋</span>
                <span>{o.label}</span>
              </button>
            ))}
          </div>
          <div className="v2-btn-row" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="v2-btn-sm v2-btn-outline" disabled={value.length === 0} onClick={() => onChange(value.slice(0, -1))}>{t('activityOrderUndo')}</button>
            <button type="button" className="v2-btn-sm v2-btn-outline" disabled={value.length === 0} onClick={() => onChange([])}>{t('activityOrderReset')}</button>
          </div>
        </>
      )}
      {locked && correct !== undefined && (
        <p className="v2-field-hint">
          {t('activityOrderCorrect')}{' '}
          {correct.map((token, i) => `${i + 1}. ${labelOf.get(token)}`).join('  ')}
        </p>
      )}
    </div>
  )
}

function pillClass(selected, locked, isCorrect) {
  let name = 'v2-pill-option'
  if (selected) name += ' is-selected'
  if (locked && isCorrect) name += ' is-correct'
  if (locked && selected && isCorrect === false) name += ' is-wrong'
  return name
}

// Pick options, then tag each pick. A locked view with a revealed key tags every option.
function SelectThenTagPart({ part, value, onChange, locked, correct }) {
  const { t } = useI18n()
  const atMax = part.max !== null && value.selected.length >= part.max

  function toggle(token) {
    if (locked) return
    if (value.selected.includes(token)) {
      const { [token]: _dropped, ...tags } = value.tags
      return onChange({ selected: value.selected.filter((x) => x !== token), tags })
    }
    if (atMax) return
    onChange({ selected: [...value.selected, token], tags: value.tags })
  }

  const tagged = part.options.filter((o) => value.selected.includes(o.token) || (locked && correct !== undefined))
  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      {/* A bare "at least 1" would contradict a prompt that states a higher minimum, which the
          package scores through a rule rather than blocks. */}
      {(part.min > 1 || part.max !== null) && (
        <p className="v2-field-hint">
          {part.max === null ? t('activityChooseAtLeast', { n: part.min }) : t('activityChooseRange', { min: part.min, max: part.max })}
        </p>
      )}
      <div className="v2-choice-list" role="group">
        {part.options.map((option) => {
          const selected = value.selected.includes(option.token)
          return (
            <button
              key={option.token}
              type="button"
              role="checkbox"
              aria-checked={selected}
              className={choiceClass(selected, locked, undefined)}
              disabled={locked || (!selected && atMax)}
              onClick={() => toggle(option.token)}
            >
              <span className="v2-choice-mark" aria-hidden="true">{selected ? '☑' : '☐'}</span>
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>
      {tagged.length > 0 && (
        <div className="v2-tag-block">
          <p className="v2-part-prompt">{part.tag_prompt ?? t('activityTagHint')}</p>
          {tagged.map((option) => (
            <div key={option.token} className="v2-row-part">
              <div className="v2-row-label">{option.label}</div>
              <div className="v2-pill-group" role="radiogroup" aria-label={option.label}>
                {part.tags.map((tag) => {
                  const selected = value.tags[option.token] === tag.id
                  const isCorrect = correct === undefined ? undefined : correct[option.token] === tag.id
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={pillClass(selected, locked, isCorrect)}
                      disabled={locked}
                      onClick={() => onChange({ ...value, tags: { ...value.tags, [option.token]: tag.id } })}
                    >
                      <span className="v2-pill-label">{tag.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Rows x dimensions; each cell is a multi-select (at least one pick per cell).
function MatrixMultiPart({ part, value, onChange, locked, correct }) {
  const { t } = useI18n()
  function toggle(rowToken, dimKey, id) {
    if (locked) return
    const row = value[rowToken] ?? {}
    const picks = row[dimKey] ?? []
    const next = picks.includes(id) ? picks.filter((x) => x !== id) : [...picks, id]
    onChange({ ...value, [rowToken]: { ...row, [dimKey]: next } })
  }
  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      <p className="v2-field-hint">{t('activityMatrixHint')}</p>
      {part.rows.map((row) => (
        <div key={row.token} className="v2-matrix-row">
          <div className="v2-row-label">{row.label}</div>
          {part.dimensions.map((d) => (
            <div key={d.key} className="v2-row-part">
              <div className="v2-field-hint">{d.label}</div>
              <div className="v2-pill-group" role="group" aria-label={`${row.label} — ${d.label}`}>
                {d.options.map((o) => {
                  const selected = (value[row.token]?.[d.key] ?? []).includes(o.id)
                  const isCorrect = correct === undefined ? undefined : (correct[row.token]?.[d.key] ?? []).includes(o.id)
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      className={pillClass(selected, locked, isCorrect)}
                      disabled={locked}
                      onClick={() => toggle(row.token, d.key, o.id)}
                    >
                      <span className="v2-pill-label">{o.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
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
        if (part.type === 'ordering') return <OrderingPart key={part.key} {...props} />
        if (part.type === 'select_then_tag') return <SelectThenTagPart key={part.key} {...props} />
        if (part.type === 'matrix_multi') return <MatrixMultiPart key={part.key} {...props} />
        return part.type === 'single_choice' || part.type === 'multi_select'
          ? <ChoicePart key={part.key} {...props} />
          : <RowPart key={part.key} {...props} />
      })}
    </div>
  )
}
