import { useEffect, useId, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { runRecipe } from './recipeOps.js'

// Renders one server-projected item and collects its answer. `answer` is keyed by part key:
//   single_choice  -> option token
//   multi_select   -> [option token]
//   ordering       -> [option token] in the learner's order (complete when every step is placed)
//   categorize /
//   verdict_matrix -> { rowToken: categoryId }
//   select_then_tag -> { selected: [option token], tags: { optionToken: tagId } } (every pick tagged)
//   matrix_multi   -> { rowToken: { dimensionKey: [optionId] } } (every row, every dimension)
//   diagram_pick   -> node token
//   policy_builder -> { permissions: [token], conditions: [token] } (at least one permission)
//   recipe_pipeline -> [{ op, params: { name: value } }] (1 to max_steps steps)
// `correct` (only after the item is locked, and only when the package reveals answers) has the
// same shape, so the view can mark the right choices.

export function emptyAnswer(item) {
  const answer = {}
  for (const part of item.parts) {
    if (part.type === 'multi_select' || part.type === 'ordering' || part.type === 'recipe_pipeline') answer[part.key] = []
    else if (part.type === 'single_choice' || part.type === 'diagram_pick') answer[part.key] = null
    else if (part.type === 'select_then_tag') answer[part.key] = { selected: [], tags: {} }
    else if (part.type === 'policy_builder') answer[part.key] = { permissions: [], conditions: [] }
    else answer[part.key] = {}
  }
  return answer
}

export function isComplete(item, answer) {
  return item.parts.every((part) => {
    const value = answer[part.key]
    if (part.type === 'single_choice' || part.type === 'diagram_pick') return typeof value === 'string'
    if (part.type === 'ordering') return value.length === part.options.length
    // Submitting locks the evidence, so an accidental empty policy is not accepted here.
    if (part.type === 'policy_builder') return value.permissions.length > 0
    if (part.type === 'recipe_pipeline') return value.length > 0 && value.length <= part.max_steps
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

// Node outlines follow the source game: entity = box, process = circle, store = two lines.
const NODE_HALF = { entity: [50, 25], store: [50, 20] }
const PROCESS_R = 30

// Where the segment from a node's centre towards (tx, ty) leaves the node's outline.
function nodeEdge(node, tx, ty) {
  const dx = tx - node.x
  const dy = ty - node.y
  const len = Math.hypot(dx, dy) || 1
  let d
  if (node.kind === 'process') d = PROCESS_R
  else {
    const [hw, hh] = NODE_HALF[node.kind]
    d = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy)) * len
  }
  return [node.x + (dx / len) * d, node.y + (dy / len) * d]
}

// The package's view_box often leaves wide margins; crop to what is drawn so it renders larger.
// Label widths are estimated (~0.6em per character), which is enough for a margin.
function diagramBounds(part) {
  const { view_box: [w, h], nodes, boundaries } = part.diagram
  const xs = []
  const ys = []
  for (const n of nodes) {
    const [hw, hh] = n.kind === 'process' ? [PROCESS_R, PROCESS_R] : NODE_HALF[n.kind]
    const half = Math.max(hw, (String(n.label ?? '').length * 12 * 0.6) / 2)
    xs.push(n.x - half, n.x + half)
    ys.push(n.y - hh, n.y + hh)
  }
  for (const b of boundaries) {
    xs.push(b.x1, b.x2, b.x1 + 6 + String(b.label ?? '').length * 10 * 0.62)
    ys.push(b.y1, b.y2)
  }
  const pad = 16
  const x0 = Math.max(0, Math.min(...xs) - pad)
  const y0 = Math.max(0, Math.min(...ys) - pad)
  const x1 = Math.min(w, Math.max(...xs) + pad)
  const y1 = Math.min(h, Math.max(...ys) + pad)
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, w, h]
}

function diagramNodeClass(selected, locked, isCorrect) {
  let name = 'v2-dfd-node'
  if (selected) name += ' is-selected'
  if (locked && isCorrect) name += ' is-correct'
  if (locked && selected && !isCorrect) name += ' is-wrong'
  return name
}

function DiagramPickPart({ part, value, onChange, locked, correct }) {
  const { t } = useI18n()
  // Several diagrams can share a page (attempt review), so the arrow marker id must be unique.
  const markerId = `v2-dfd-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { nodes, flows, boundaries } = part.diagram
  const [vx, vy, vw, vh] = diagramBounds(part)
  const byToken = new Map(nodes.map((n) => [n.token, n]))
  const pick = (token) => { if (!locked) onChange(token) }
  const isCorrect = (token) => (correct === undefined ? undefined : correct === token)
  const segments = flows.flatMap((f) => {
    const from = byToken.get(f.from)
    const to = byToken.get(f.to)
    if (!from || !to) return []
    const [x1, y1] = nodeEdge(from, to.x, to.y)
    const [x2, y2] = nodeEdge(to, from.x, from.y)
    return [{ x1, y1, x2, y2, label: f.label }]
  })
  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      <div className="v2-dfd">
        {/* The drawing is for pointer users; the list below is the accessible control. */}
        <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} aria-hidden="true" focusable="false">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="v2-dfd-arrowhead" />
            </marker>
          </defs>
          {boundaries.map((b, i) => (
            <g key={`b${i}`}>
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} className="v2-dfd-boundary" />
              <text x={b.x1 + 6} y={b.y1 + 10} className="v2-dfd-boundary-label">{b.label}</text>
            </g>
          ))}
          {segments.map((sg, i) => (
            <line key={`f${i}`} x1={sg.x1} y1={sg.y1} x2={sg.x2} y2={sg.y2} className="v2-dfd-flow" markerEnd={`url(#${markerId})`} />
          ))}
          {nodes.map((n) => (
            <g
              key={n.token}
              className={diagramNodeClass(value === n.token, locked, isCorrect(n.token))}
              onClick={() => pick(n.token)}
            >
              {n.kind === 'process' && <circle cx={n.x} cy={n.y} r={PROCESS_R} className="v2-dfd-shape" />}
              {n.kind === 'entity' && <rect x={n.x - 50} y={n.y - 25} width={100} height={50} rx={4} className="v2-dfd-shape" />}
              {n.kind === 'store' && (
                <>
                  <rect x={n.x - 50} y={n.y - 20} width={100} height={40} className="v2-dfd-store-fill" />
                  <line x1={n.x - 50} y1={n.y - 20} x2={n.x + 50} y2={n.y - 20} className="v2-dfd-store-line" />
                  <line x1={n.x - 50} y1={n.y + 20} x2={n.x + 50} y2={n.y + 20} className="v2-dfd-store-line" />
                </>
              )}
              <text x={n.x} y={n.y + 4} className="v2-dfd-node-label">{n.label}</text>
            </g>
          ))}
          {/* Flow labels last, so no node covers them; centred on the visible stretch of the line. */}
          {segments.map((sg, i) => (
            <text key={`fl${i}`} x={(sg.x1 + sg.x2) / 2} y={(sg.y1 + sg.y2) / 2 - 6} className="v2-dfd-flow-label">{sg.label}</text>
          ))}
        </svg>
      </div>
      <div className="v2-choice-list" role="radiogroup" aria-label={part.prompt ?? t('activityDiagramNodes')}>
        {nodes.map((n) => {
          const selected = value === n.token
          return (
            <button
              key={n.token}
              type="button"
              role="radio"
              aria-checked={selected}
              className={choiceClass(selected, locked, isCorrect(n.token))}
              disabled={locked}
              onClick={() => pick(n.token)}
            >
              <span className="v2-choice-mark" aria-hidden="true">{selected ? '◉' : '○'}</span>
              <span>
                <strong>{n.label}</strong>
                {n.detail
                  ? <span className="v2-subtext v2-dfd-detail">{n.detail}</span>
                  : <span className="v2-dfd-kind"> · {t(`activityDiagramKind_${n.kind}`)}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PolicyChoices({ heading, choices, chosen, correctList, notes, locked, onToggle }) {
  const correctSet = correctList ? new Set(correctList) : null
  return (
    <div className="v2-policy-group">
      {heading && <p className="v2-part-prompt">{heading}</p>}
      <div className="v2-choice-list" role="group" aria-label={heading}>
        {choices.map((choice) => {
          const selected = chosen.includes(choice.token)
          const isCorrect = correctSet ? correctSet.has(choice.token) : undefined
          const note = notes?.get(choice.token)
          return (
            <button
              key={choice.token}
              type="button"
              role="checkbox"
              aria-checked={selected}
              className={choiceClass(selected, locked, isCorrect)}
              disabled={locked}
              onClick={() => onToggle(choice.token)}
            >
              <span className="v2-choice-mark" aria-hidden="true">{selected ? '☑' : '☐'}</span>
              <span>
                <strong>{choice.label}</strong>
                {choice.detail && <span className="v2-subtext v2-dfd-detail">{choice.detail}</span>}
                {note && <span className="v2-policy-note">{note}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Pick permissions (RBAC) and conditions (ABAC). After the item locks, and only when the package
// reveals answers, `details` carries the server's decision for every fixture request.
function PolicyBuilderPart({ part, value, onChange, locked, correct, details }) {
  const { t } = useI18n()
  const notes = details ? new Map(details.notes.map((n) => [n.token, n.note])) : null
  const toggle = (list) => (token) => {
    if (locked) return
    const current = value[list]
    onChange({ ...value, [list]: current.includes(token) ? current.filter((x) => x !== token) : [...current, token] })
  }
  const passed = details ? details.requests.filter((r) => r.allowed === r.expected).length : 0
  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-field-hint">{part.prompt}</p>}
      <PolicyChoices heading={part.permissions_prompt} choices={part.permissions} chosen={value.permissions} correctList={correct?.permissions} notes={notes} locked={locked} onToggle={toggle('permissions')} />
      <PolicyChoices heading={part.conditions_prompt} choices={part.conditions} chosen={value.conditions} correctList={correct?.conditions} notes={notes} locked={locked} onToggle={toggle('conditions')} />
      {!locked && value.permissions.length === 0 && <p className="v2-field-hint">{t('activityPolicyNeedPermission')}</p>}
      {details && (
        <div className="v2-policy-results">
          <p className="v2-part-prompt">{t('activityPolicyResults', { n: passed, total: details.requests.length })}</p>
          <ul>
            {details.requests.map((r, i) => {
              const ok = r.allowed === r.expected
              return (
                <li key={i} className={ok ? 'is-pass' : 'is-fail'}>
                  <span className="v2-policy-icon" aria-hidden="true">{ok ? '✓' : '!'}</span>
                  <span>
                    <strong>{r.title}</strong>
                    {r.reason && <span className="v2-subtext v2-dfd-detail">{r.reason}</span>}
                    <span className="v2-policy-pill">
                      {t('activityPolicyDecision', { actual: r.allowed ? 'ALLOW' : 'DENY', expected: r.expected ? 'ALLOW' : 'DENY' })}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

const snippet = (text) => (text.length > 60 ? `${text.slice(0, 60)}…` : text)

// Build a recipe from the operation library. The preview runs in this browser (recipeOps.js, no
// targets); the server runs the submitted recipe itself and scores that.
function RecipePipelinePart({ part, value, onChange, locked, correct, details }) {
  const { t } = useI18n()
  const [preview, setPreview] = useState({ output: '', outputs: [] })
  const ops = new Map(part.operations.map((o) => [o.id, o]))
  const steps = locked && correct && value.length === 0 ? correct : value

  useEffect(() => {
    let live = true
    if (steps.length === 0) {
      setPreview({ output: '', outputs: [] })
      return undefined
    }
    runRecipe(part.input, steps).then((r) => { if (live) setPreview(r) })
    return () => { live = false }
  }, [part.input, JSON.stringify(steps)])

  const add = (op) => {
    if (locked || value.length >= part.max_steps) return
    onChange([...value, { op: op.id, params: Object.fromEntries(op.params.map((p) => [p.key, ''])) }])
  }
  const move = (i, d) => {
    const next = [...value]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  const setParam = (i, key, v) => onChange(value.map((s, j) => (j === i ? { ...s, params: { ...s.params, [key]: v } } : s)))
  const failed = preview.output.startsWith('[ERROR')

  return (
    <div className="v2-part">
      {part.prompt && <p className="v2-part-prompt">{part.prompt}</p>}
      <p className="v2-part-prompt">{t('activityRecipeInput')}</p>
      <pre className="v2-recipe-data">{part.input}</pre>

      {!locked && (
        <>
          <p className="v2-part-prompt">{t('activityRecipeOperations')}</p>
          <div className="v2-recipe-ops">
            {part.operations.map((op) => (
              <button key={op.id} type="button" className="v2-btn v2-btn-sm" disabled={value.length >= part.max_steps} onClick={() => add(op)} title={op.detail}>
                + {op.label}
              </button>
            ))}
          </div>
          <p className="v2-field-hint">{t('activityRecipeMax', { n: part.max_steps })}</p>
        </>
      )}

      <p className="v2-part-prompt">{locked && correct && value.length === 0 ? t('activityRecipeSolution') : t('activityRecipePipeline')}</p>
      {steps.length === 0 ? (
        <p className="v2-field-hint">{t('activityRecipeEmpty')}</p>
      ) : (
        <ol className="v2-recipe-steps">
          {steps.map((step, i) => {
            const op = ops.get(step.op)
            const out = preview.outputs[i]
            return (
              <li key={i} className="v2-recipe-step">
                <div className="v2-recipe-step-head">
                  <strong>{t('activityRecipeStep', { n: i + 1 })} · {op?.label ?? step.op}</strong>
                  {!locked && (
                    <span className="v2-recipe-step-controls">
                      <button type="button" className="v2-btn v2-btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('activityRecipeMoveUp', { n: i + 1 })}>↑</button>
                      <button type="button" className="v2-btn v2-btn-sm" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={t('activityRecipeMoveDown', { n: i + 1 })}>↓</button>
                      <button type="button" className="v2-btn v2-btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('activityRecipeRemove', { n: i + 1 })}>✕</button>
                    </span>
                  )}
                </div>
                {op?.params.map((p) => (
                  <label key={p.key} className="v2-recipe-param">
                    <span>{p.label}</span>
                    <input
                      className="v2-recipe-input"
                      type="text"
                      value={step.params[p.key] ?? ''}
                      placeholder={p.placeholder}
                      maxLength={part.max_param}
                      disabled={locked}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setParam(i, p.key, e.target.value)}
                    />
                  </label>
                ))}
                {out !== undefined && <code className={`v2-recipe-snippet${out.startsWith('[ERROR') ? ' is-error' : ''}`}>{snippet(out)}</code>}
              </li>
            )
          })}
        </ol>
      )}

      {!locked && steps.length > 0 && (
        <>
          <p className="v2-part-prompt">{t('activityRecipeOutput')}</p>
          <pre className={`v2-recipe-data${failed ? ' is-error' : ''}`}>{preview.output}</pre>
        </>
      )}
      {details && (
        <div className={`v2-recipe-result ${details.matched ? 'is-pass' : 'is-fail'}`}>
          <p className="v2-part-prompt">{t('activityRecipeServerOutput')}</p>
          <pre className="v2-recipe-data">{details.output}</pre>
          <p className="v2-part-prompt">{t('activityRecipeTarget')}</p>
          <pre className="v2-recipe-data">{details.target}</pre>
        </div>
      )}
      {locked && correct && value.length > 0 && (
        <div className="v2-recipe-solution">
          <p className="v2-part-prompt">{t('activityRecipeSolution')}</p>
          <ol>
            {correct.map((s, i) => (
              <li key={i}>
                {ops.get(s.op)?.label ?? s.op}
                {Object.entries(s.params ?? {}).map(([k, v]) => <code key={k}> {k}={v}</code>)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

export default function ItemView({ item, answer, onAnswerChange, locked = false, correct, details }) {
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
        if (part.type === 'policy_builder') return <PolicyBuilderPart key={part.key} {...props} details={details?.[part.key]} />
        if (part.type === 'recipe_pipeline') return <RecipePipelinePart key={part.key} {...props} details={details?.[part.key]} />
        if (part.type === 'ordering') return <OrderingPart key={part.key} {...props} />
        if (part.type === 'select_then_tag') return <SelectThenTagPart key={part.key} {...props} />
        if (part.type === 'matrix_multi') return <MatrixMultiPart key={part.key} {...props} />
        if (part.type === 'diagram_pick') return <DiagramPickPart key={part.key} {...props} />
        return part.type === 'single_choice' || part.type === 'multi_select'
          ? <ChoicePart key={part.key} {...props} />
          : <RowPart key={part.key} {...props} />
      })}
    </div>
  )
}
