import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../auth/api.js'
import { useI18n } from '../i18n/I18nContext.jsx'
import { applyRosterImport, cancelRosterPending, listRosterPending, previewRosterImport } from './api.js'
import FileInput from '../components/FileInput.jsx'

const STATUSES = ['enroll', 'update', 'unchanged', 'pending', 'invalid', 'duplicate', 'other_section', 'staff']
const WRITES = new Set(['enroll', 'update', 'pending'])

const NAME_PARTS = 3

// Column mapping editor (PS-TASK-20260925-747): student ID and email are required; up to three
// name parts each for Thai and English; section and course code are optional.
function MappingEditor({ headers, mapping, sample, onChange }) {
  const { t } = useI18n()
  const select = (value, onPick, required) => (
    <select value={value ?? ''} onChange={(e) => onPick(e.target.value || null)}>
      <option value="">{required ? '—' : t('rosterMapNone')}</option>
      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
    </select>
  )
  const setPart = (field, index, value) => {
    const parts = [...(mapping[field] ?? [])]
    while (parts.length < NAME_PARTS) parts.push(null)
    parts[index] = value
    onChange({ ...mapping, [field]: parts.filter(Boolean) })
  }
  const row = (label, control) => (
    <label className="v2-subtext" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', flexWrap: 'wrap' }}>
      <span style={{ minWidth: 150 }}>{label}</span>
      {control}
    </label>
  )
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--v2-border)', borderRadius: 10 }}>
      {row(`${t('rosterMapStudentId')} *`, select(mapping.studentId, (v) => onChange({ ...mapping, studentId: v }), true))}
      {row(`${t('rosterMapEmail')} *`, select(mapping.email, (v) => onChange({ ...mapping, email: v }), true))}
      {row(t('rosterMapNameTh'), [0, 1, 2].map((i) => <span key={i}>{select(mapping.nameTh?.[i], (v) => setPart('nameTh', i, v))}</span>))}
      {row(t('rosterMapNameEn'), [0, 1, 2].map((i) => <span key={i}>{select(mapping.nameEn?.[i], (v) => setPart('nameEn', i, v))}</span>))}
      {row(t('rosterMapSection'), select(mapping.section, (v) => onChange({ ...mapping, section: v })))}
      {row(t('rosterMapCourseCode'), select(mapping.courseCode, (v) => onChange({ ...mapping, courseCode: v })))}
      {sample?.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="v2-table">
            <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{sample.map((r, i) => <tr key={i}>{headers.map((h, j) => <td key={h} className="is-muted">{r[j] ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// Owner/teacher/admin: import the registrar's student list. Choose the file, check the preview
// (with the encoding the server detected), then confirm. Students without an account wait as
// pending rows and join the Section at their first sign-in.
export default function RosterImportCard({ sectionId, onImported }) {
  const { t } = useI18n()
  const [file, setFile] = useState(null) // { name, base64 }
  const [encoding, setEncoding] = useState('auto')
  const [section, setSection] = useState(null)
  const [mapping, setMapping] = useState(null) // null = let the server suggest from the header
  const [showMapping, setShowMapping] = useState(false)
  const [preview, setPreview] = useState(null)
  const [state, setState] = useState('idle') // idle | loading | ready | applying
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [pending, setPending] = useState([])

  // A known error code has its own message; anything else falls back to the generic one.
  const errorText = (err) => {
    const key = `rosterError_${err instanceof ApiError ? err.code : 'REQUEST_FAILED'}`
    const text = t(key)
    return text === key ? t('genericError') : text
  }

  const loadPending = useCallback(async () => {
    try {
      setPending((await listRosterPending(sectionId)).pending)
    } catch {
      setPending([])
    }
  }, [sectionId])

  useEffect(() => { loadPending() }, [loadPending])

  async function runPreview(next) {
    setState('loading')
    setError(null)
    try {
      const result = await previewRosterImport(sectionId, {
        fileBase64: next.file.base64,
        encoding: next.encoding,
        section: next.section,
        ...(next.mapping ? { mapping: next.mapping } : {}),
      })
      setPreview(result)
      if (result.needsMapping) setShowMapping(true)
      if (!next.section && result.section) setSection(result.section)
      setState('ready')
    } catch (err) {
      setPreview(null)
      setError(errorText(err))
      setState('idle')
    }
  }

  async function chooseFile(event) {
    const chosen = event.target.files?.[0]
    if (!chosen) return
    setDone(null)
    const next = { name: chosen.name, base64: toBase64(await chosen.arrayBuffer()) }
    setFile(next)
    setSection(null)
    setMapping(null)
    setShowMapping(false)
    await runPreview({ file: next, encoding, section: null, mapping: null })
  }

  async function confirm() {
    setState('applying')
    setError(null)
    try {
      const result = await applyRosterImport(sectionId, { fileBase64: file.base64, encoding, section, ...(mapping ? { mapping } : {}) })
      setDone(result.counts)
      setPreview(null)
      setFile(null)
      setState('idle')
      await loadPending()
      onImported?.()
    } catch (err) {
      setError(errorText(err))
      setState('ready')
    }
  }

  async function cancel(entryId) {
    try {
      await cancelRosterPending(sectionId, entryId)
    } finally {
      await loadPending()
    }
  }

  const writes = preview && !preview.needsMapping ? preview.rows.filter((r) => WRITES.has(r.status)).length : 0
  const currentMapping = mapping ?? preview?.mapping ?? (preview?.suggestion ? { ...preview.suggestion } : null)
  const changeMapping = (next) => {
    setMapping(next)
    if (next.studentId && next.email) runPreview({ file, encoding, section, mapping: next })
  }

  return (
    <div className="v2-card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('rosterImportHeading')}</div>
      <p className="v2-field-hint" style={{ marginTop: 0 }}>{t('rosterImportHint')}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <FileInput accept=".csv,text/csv" onChange={chooseFile} disabled={state === 'loading' || state === 'applying'} label={t('rosterImportChoose')} fileName={file?.name ?? ''} />
        <label className="v2-inline-field">
          {t('rosterEncodingLabel')}{' '}
          <select
            value={encoding}
            onChange={(e) => {
              setEncoding(e.target.value)
              if (file) runPreview({ file, encoding: e.target.value, section, mapping })
            }}
          >
            <option value="auto">{t('rosterEncodingAuto')}</option>
            <option value="tis-620">TIS-620 / Windows-874</option>
            <option value="utf-8">UTF-8</option>
          </select>
        </label>
        {preview && !preview.needsMapping && preview.fileSections.length > 1 && (
          <label className="v2-inline-field">
            {t('rosterSectionLabel')}{' '}
            <select
              value={section ?? ''}
              onChange={(e) => {
                setSection(e.target.value || null)
                runPreview({ file, encoding, section: e.target.value || null, mapping })
              }}
            >
              <option value="">—</option>
              {preview.fileSections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <p className="v2-field-error">{error}</p>}
      {done && <div className="v2-notice v2-notice-info" style={{ marginTop: 10 }}>{t('rosterImportDone', { enroll: done.enroll + done.update, pending: done.pending })}</div>}

      {preview && currentMapping && (
        <div style={{ marginTop: 10 }}>
          {preview.needsMapping ? (
            <div className="v2-notice v2-notice-error" style={{ marginBottom: 6 }}>{t('rosterNeedsMapping')}</div>
          ) : (
            <button type="button" className="v2-btn-sm v2-btn-outline" onClick={() => setShowMapping(!showMapping)}>
              {showMapping ? t('rosterMapHide') : t('rosterMapShow')}
            </button>
          )}
          {showMapping && <MappingEditor headers={preview.headers} mapping={currentMapping} sample={preview.sample} onChange={changeMapping} />}
        </div>
      )}

      {preview && !preview.needsMapping && (
        <div style={{ marginTop: 12 }}>
          <p className="v2-subtext">
            {t('rosterDetected', { encoding: preview.encoding, format: preview.format })} ·{' '}
            {STATUSES.filter((s) => preview.counts[s]).map((s) => `${t(`rosterStatus_${s}`)} ${preview.counts[s]}`).join(' · ')}
          </p>
          {preview.needsSectionChoice && <div className="v2-notice v2-notice-error">{t('rosterNeedsSection')}</div>}
          {preview.courseCodeMismatch && <div className="v2-notice v2-notice-error">{t('rosterCourseMismatch', { codes: preview.fileCourseCodes.join(', ') })}</div>}
          {preview.unmappedBytes > 0 && <div className="v2-notice v2-notice-error">{t('rosterUnmapped', { n: preview.unmappedBytes })}</div>}
          <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('activityColStudentId')}</th>
                  <th>{t('colName')}</th>
                  <th>{t('colEmail')}</th>
                  <th>{t('activitySyncColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="is-muted">{r.line}</td>
                    <td>{r.studentId}</td>
                    <td>{r.nameTh ?? '—'}{r.nameEn && <div className="is-muted">{r.nameEn}</div>}</td>
                    <td className="is-muted">{r.email}</td>
                    <td>
                      {t(`rosterStatus_${r.status}`)}
                      {r.studentIdConflict && <div className="v2-field-error" style={{ margin: 0 }}>{t('rosterIdConflict', { id: r.studentIdConflict })}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.missing.length > 0 && (
            <p className="v2-field-hint">
              {t('rosterMissing', { n: preview.missing.length })}: {preview.missing.map((m) => m.displayName).join(', ')}
            </p>
          )}
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-primary" disabled={writes === 0 || preview.needsSectionChoice || state === 'applying'} onClick={confirm}>
              {t('rosterConfirm', { n: writes })}
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{t('rosterPendingHeading', { n: pending.length })}</div>
          <p className="v2-field-hint" style={{ marginTop: 2 }}>{t('rosterPendingHint')}</p>
          <table className="v2-table">
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td>{p.student_id}</td>
                  <td>{p.name_th ?? '—'}</td>
                  <td className="is-muted">{p.email}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="v2-btn v2-btn-secondary" style={{ padding: '4px 10px', fontSize: '.75rem' }} onClick={() => cancel(p.id)}>
                      {t('rosterPendingCancel')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
