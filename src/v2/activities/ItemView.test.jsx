import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/I18nContext.jsx'
import ItemView, { emptyAnswer, isComplete } from './ItemView.jsx'

// Synthetic projected items (the shapes the server's projectItem sends); no activity content.
const choice = (key, n = 3) => ({ key, type: 'single_choice', options: Array.from({ length: n }, (_, i) => ({ token: `${key}t${i}`, label: `Option ${i}` })) })
const multi = (key, min, max) => ({ ...choice(key, 4), type: 'multi_select', min, max })
const ordering = { key: 'ord', type: 'ordering', options: [{ token: 'o1', label: 'A' }, { token: 'o2', label: 'B' }] }
const rows = { key: 'rows', type: 'categorize', rows: [{ token: 'r1', label: 'Row 1' }, { token: 'r2', label: 'Row 2' }], categories: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }
const verdict = { key: 'vm', type: 'verdict_matrix', rows: [{ token: 'v1', label: 'Claim 1' }], categories: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }
const tag = { key: 'tag', type: 'select_then_tag', options: [{ token: 's1', label: 'S1' }, { token: 's2', label: 'S2' }], tags: [{ id: 'k', label: 'K' }], min: 1, max: null }
const matrix = { key: 'mx', type: 'matrix_multi', rows: [{ token: 'm1', label: 'M1' }], dimensions: [{ key: 'd', label: 'D', options: [{ id: 'p', label: 'P' }] }] }
const diagram = {
  key: 'node',
  type: 'diagram_pick',
  prompt: 'Pick the node',
  diagram: {
    view_box: [400, 200],
    nodes: [
      { token: 'nA', label: 'Client', kind: 'entity', x: 60, y: 100 },
      { token: 'nB', label: 'Service', kind: 'process', x: 200, y: 100, detail: 'A process' },
      { token: 'nC', label: 'Records', kind: 'store', x: 340, y: 100 },
    ],
    flows: [{ from: 'nA', to: 'nB', label: 'Request' }],
    boundaries: [{ label: 'Edge', x1: 130, y1: 20, x2: 130, y2: 180 }],
  },
}
const policy = {
  key: 'policy',
  type: 'policy_builder',
  permissions_prompt: 'Permissions',
  conditions_prompt: 'Conditions',
  permissions: [{ token: 'pRead', label: 'Read' }, { token: 'pAdmin', label: 'Admin' }],
  conditions: [{ token: 'cOwn', label: 'Own only' }],
}
const recipe = {
  key: 'recipe',
  type: 'recipe_pipeline',
  input: '48 69',
  max_steps: 3,
  max_param: 8,
  operations: [
    { id: 'fromHex', label: 'From Hex', params: [] },
    { id: 'xor', label: 'XOR', params: [{ key: 'key', label: 'Key' }] },
  ],
}

function renderItem(item, props = {}) {
  let current
  function Harness() {
    const [answer, setAnswer] = useState(() => emptyAnswer(item))
    current = answer
    return <ItemView item={item} answer={answer} onAnswerChange={setAnswer} {...props} />
  }
  render(<I18nProvider><Harness /></I18nProvider>)
  return { answer: () => current }
}

// English labels, so the queries below read naturally (the app defaults to Thai).
beforeEach(() => window.localStorage.setItem('classops_v2_lang', 'en'))
afterEach(cleanup)

describe('emptyAnswer and isComplete', () => {
  it('start empty and incomplete for every part type', () => {
    const parts = [choice('one'), multi('many', 2, 3), ordering, rows, verdict, tag, matrix, diagram, policy, recipe]
    const item = { key: 'i', parts }
    const empty = emptyAnswer(item)
    expect(empty).toEqual({
      one: null, many: [], ord: [], rows: {}, vm: {}, tag: { selected: [], tags: {} }, mx: {},
      node: null, policy: { permissions: [], conditions: [] }, recipe: [],
    })
    for (const part of parts) expect(isComplete({ key: 'i', parts: [part] }, empty), part.type).toBe(false)
  })

  it('accept exactly the answers each part needs', () => {
    const one = (part, value) => isComplete({ key: 'i', parts: [part] }, { [part.key]: value })
    expect(one(choice('one'), 'onet0')).toBe(true)
    expect(one(multi('many', 2, 3), ['a'])).toBe(false)
    expect(one(multi('many', 2, 3), ['a', 'b'])).toBe(true)
    expect(one(multi('many', 2, 3), ['a', 'b', 'c', 'd'])).toBe(false)
    expect(one(multi('many', 1, null), ['a', 'b', 'c', 'd'])).toBe(true)
    expect(one(ordering, ['o1'])).toBe(false)
    expect(one(ordering, ['o2', 'o1'])).toBe(true)
    expect(one(rows, { r1: 'x' })).toBe(false)
    expect(one(rows, { r1: 'x', r2: 'y' })).toBe(true)
    expect(one(verdict, {})).toBe(false)
    expect(one(verdict, { v1: 'no' })).toBe(true)
    expect(one(tag, { selected: ['s1'], tags: {} })).toBe(false)
    expect(one(tag, { selected: ['s1'], tags: { s1: 'k' } })).toBe(true)
    expect(one(matrix, { m1: { d: [] } })).toBe(false)
    expect(one(matrix, { m1: { d: ['p'] } })).toBe(true)
    expect(one(diagram, 'nB')).toBe(true)
    expect(one(policy, { permissions: [], conditions: ['cOwn'] })).toBe(false)
    expect(one(policy, { permissions: ['pRead'], conditions: [] })).toBe(true)
    expect(one(recipe, [{ op: 'fromHex', params: {} }])).toBe(true)
    expect(one(recipe, Array.from({ length: 4 }, () => ({ op: 'fromHex', params: {} })))).toBe(false)
  })
})

describe('diagram_pick', () => {
  it('selects a node from the drawing or the list, and answers with its token', () => {
    const view = renderItem({ key: 'i', parts: [diagram] })
    fireEvent.click(screen.getByText('Records', { selector: 'svg text' }).closest('g'))
    expect(view.answer().node).toBe('nC')
    fireEvent.click(screen.getByRole('radio', { name: /Service/ }))
    expect(view.answer().node).toBe('nB')
    expect(screen.getByRole('radio', { name: /Service/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('gives each diagram its own arrow marker, so several can share a page', () => {
    render(
      <I18nProvider>
        <ItemView item={{ key: 'a', parts: [diagram] }} answer={{ node: null }} onAnswerChange={() => {}} />
        <ItemView item={{ key: 'b', parts: [diagram] }} answer={{ node: null }} onAnswerChange={() => {}} />
      </I18nProvider>,
    )
    const ids = [...document.querySelectorAll('marker')].map((m) => m.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const line of document.querySelectorAll('line[marker-end]')) {
      const id = line.getAttribute('marker-end').slice(5, -1)
      expect(document.getElementById(id).closest('svg')).toBe(line.closest('svg'))
    }
  })
})

describe('policy_builder', () => {
  it('toggles permissions and conditions into separate token lists', () => {
    const view = renderItem({ key: 'i', parts: [policy] })
    fireEvent.click(screen.getByRole('checkbox', { name: /Read/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Own only/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Admin/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Admin/ }))
    expect(view.answer().policy).toEqual({ permissions: ['pRead'], conditions: ['cOwn'] })
  })

  it('shows the request results and notes only when feedback carries them', () => {
    renderItem({ key: 'i', parts: [policy] }, {
      locked: true,
      correct: { policy: { permissions: ['pRead'], conditions: ['cOwn'] } },
      details: { policy: { requests: [{ title: 'Own read', allowed: false, expected: true }], notes: [{ token: 'cOwn', note: 'Scope note' }] } },
    })
    expect(screen.getByText('Own read')).toBeTruthy()
    expect(screen.getByText('Scope note')).toBeTruthy()
    expect(document.querySelector('.v2-policy-results li.is-fail')).toBeTruthy()
  })
})

describe('recipe_pipeline', () => {
  it('builds steps as plain {op, params}, reorders and removes them, and enforces the limits', async () => {
    const view = renderItem({ key: 'i', parts: [recipe] })
    fireEvent.click(screen.getByRole('button', { name: '+ XOR' }))
    fireEvent.click(screen.getByRole('button', { name: '+ From Hex' }))
    expect(view.answer().recipe).toEqual([{ op: 'xor', params: { key: '' } }, { op: 'fromHex', params: {} }])

    fireEvent.click(screen.getByRole('button', { name: /step 2 up/i }))
    const key = screen.getByRole('textbox')
    expect(key.getAttribute('maxlength')).toBe('8')
    fireEvent.change(key, { target: { value: '0x01' } })
    expect(view.answer().recipe).toEqual([{ op: 'fromHex', params: {} }, { op: 'xor', params: { key: '0x01' } }])
    // Nothing UI-only (ids, outputs) leaks into what is submitted.
    for (const step of view.answer().recipe) expect(Object.keys(step).sort()).toEqual(['op', 'params'])

    fireEvent.click(screen.getByRole('button', { name: '+ From Hex' }))
    expect(screen.getByRole('button', { name: '+ XOR' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /remove step 3/i }))
    expect(view.answer().recipe).toHaveLength(2)

    // The local preview runs the same operations: 48 69 -> "Hi" -> xor 0x01 -> "Ih".
    await waitFor(() => expect([...document.querySelectorAll('.v2-recipe-data')].at(-1).textContent).toBe('Ih'))
  })

  it('shows the reference recipe and the server result after the reveal', async () => {
    await act(async () => {
      renderItem({ key: 'i', parts: [recipe] }, {
        locked: true,
        correct: { recipe: [{ op: 'fromHex', params: {} }] },
        details: { recipe: { output: 'Hi', target: 'Hi', matched: true } },
      })
    })
    expect(document.querySelector('.v2-recipe-result.is-pass')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '+ XOR' })).toBeNull()
  })
})
