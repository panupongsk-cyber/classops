import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { t, translations } from './translations.js'

const V2 = join(import.meta.dirname, '..')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(jsx?)$/.test(name) && !/\.test\.jsx?$/.test(name) ? [path] : []
  })
}

// Every literal key passed to t('...') anywhere in src/v2 (template-literal keys are checked below).
function literalKeys() {
  const keys = new Map()
  for (const file of sourceFiles(V2)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(?<![\w.$])t\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
      if (!keys.has(m[1])) keys.set(m[1], file.slice(V2.length + 1))
    }
  }
  return keys
}

describe('translations', () => {
  it('has the same keys in Thai and English', () => {
    const th = Object.keys(translations.th)
    const en = Object.keys(translations.en)
    expect(th.filter((k) => !en.includes(k))).toEqual([])
    expect(en.filter((k) => !th.includes(k))).toEqual([])
  })

  it('has no empty strings', () => {
    for (const lang of ['th', 'en']) {
      expect(Object.entries(translations[lang]).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([])
    }
  })

  it('defines every literal key the UI passes to t()', () => {
    const keys = literalKeys()
    expect(keys.size).toBeGreaterThan(200)
    const missing = [...keys].filter(([k]) => !(k in translations.th) || !(k in translations.en)).map(([k, f]) => `${k} (${f})`)
    expect(missing).toEqual([])
  })

  it('defines every key built from a template or a list, for every value it can take', () => {
    const read = (file) => readFileSync(join(V2, file), 'utf8')
    const list = (file, name) => JSON.parse(read(file).match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1].replace(/'/g, '"'))
    const cap = (s) => s[0].toUpperCase() + s.slice(1)
    const families = [
      ...['entity', 'process', 'store'].map((k) => `activityDiagramKind_${k}`), // ItemView
      ...list('sections/RosterImportCard.jsx', 'STATUSES').map((s) => `rosterStatus_${s}`),
      ...list('attendance/AttendancePage.jsx', 'WEEKDAY_KEYS'),
      ...[...read('sections/CreateCoursePage.jsx').matchAll(/labelKey: '([A-Za-z0-9_]+)'/g)].map((m) => m[1]),
      ...['exam', 'set'].map((k) => `assignKind_${k}`), // PracticeAssignmentsPage
      ...['best', 'first', 'last', 'mean'].map((p) => `assignPolicy_${p}`),
      ...['after_due', 'after_submit'].map((p) => `assignReview_${p}`),
      ...['not_started', 'in_progress', 'submitted'].map((s) => `resultsStatus_${s}`), // server learnerResults
      ...['practice', 'quiz', 'exam'].map((m) => `practiceMode_${m}`), // server attempt modes
      ...['first', 'best', 'last', 'mean'].map((p) => `activityPolicy${cap(p)}`), // EvidencePage
    ]
    expect(families.length).toBeGreaterThan(35)
    expect(families.filter((k) => !(k in translations.th) || !(k in translations.en))).toEqual([])
  })

  it('interpolates every {name} and falls back to English, then to the key', () => {
    expect(t('en', 'activityRecipeStep', { n: 3 })).toBe('Step 3')
    expect(t('th', 'activityRecipeStep', { n: 3 })).toBe('ขั้นที่ 3')
    expect(t('th', 'no_such_key')).toBe('no_such_key')
  })
})
