import { useRef, useState } from 'react'
import { ApiError } from '../auth/api.js'
import { useI18n } from '../i18n/I18nContext.jsx'
import FileInput from '../components/FileInput.jsx'
import { applyGradebookImport, previewGradebookImport } from './api.js'

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const formatPoints = (value) => (value === null ? '—' : String(value))

const MAX_FILE_BYTES = 512 * 1024

// Gradebook CSV import (#2437): choose a file in the export's shape, check the preview, confirm.
// Rows find their student by Student ID, else by email; blank cells leave scores unchanged;
// rejected rows are listed and skipped. The server re-plans from the file on confirm.
export default function GradebookImportCard({ sectionId, onImported }) {
  const { t } = useI18n()
  const [file, setFile] = useState(null) // { name, base64 }
  const [encoding, setEncoding] = useState('auto')
  const [preview, setPreview] = useState(null)
  const [state, setState] = useState('idle') // idle | loading | ready | applying
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  // Only the latest preview request may set state: a slower earlier response, or one that lands
  // after Cancel or a new file, is dropped.
  const requestRef = useRef(0)

  const errorText = (err) => {
    const key = `gradeImportError_${err instanceof ApiError ? err.code : 'REQUEST_FAILED'}`
    const text = t(key)
    return text === key ? t('genericError') : text
  }

  async function runPreview(next, nextEncoding) {
    const request = ++requestRef.current
    setPreview(null)
    setState('loading')
    setError(null)
    try {
      const result = await previewGradebookImport(sectionId, { fileBase64: next.base64, encoding: nextEncoding })
      if (request !== requestRef.current) return
      setPreview(result)
      setState('ready')
    } catch (err) {
      if (request !== requestRef.current) return
      setError(errorText(err))
      setState('idle')
    }
  }

  function reset() {
    requestRef.current += 1
    setPreview(null)
    setFile(null)
    setState('idle')
  }

  async function chooseFile(event) {
    const input = event.target
    const chosen = input.files?.[0]
    if (!chosen) return
    setDone(null)
    // Cleared so the same file can be picked again after a Cancel or an import.
    input.value = ''
    if (chosen.size === 0 || chosen.size > MAX_FILE_BYTES) {
      reset()
      setError(t(chosen.size === 0 ? 'gradeImportError_EMPTY_FILE' : 'gradeImportError_FILE_TOO_LARGE'))
      return
    }
    const next = { name: chosen.name, base64: toBase64(await chosen.arrayBuffer()) }
    setFile(next)
    await runPreview(next, encoding)
  }

  async function confirm() {
    setState('applying')
    setError(null)
    try {
      const result = await applyGradebookImport(sectionId, { fileBase64: file.base64, encoding })
      reset()
      setDone(result.counts)
      onImported?.()
    } catch (err) {
      setError(errorText(err))
      setState('ready')
    }
  }

  const changed = preview ? preview.rows.filter((r) => r.status === 'change') : []
  const rejected = preview ? preview.rows.filter((r) => r.status === 'rejected') : []
  const reasonText = (r) =>
    r.reason === 'INVALID_SCORE'
      ? t('gradeImportReason_INVALID_SCORE', { column: r.invalidHeader, value: r.invalidValue })
      : t(`gradeImportReason_${r.reason}`)

  return (
    <div className="v2-card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('gradeImportHeading')}</div>
      <p className="v2-field-hint" style={{ marginTop: 0 }}>{t('gradeImportHint')}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <FileInput accept=".csv,text/csv" onChange={chooseFile} disabled={state === 'loading' || state === 'applying'} label={t('gradeImportChoose')} fileName={file?.name ?? ''} />
        <label className="v2-inline-field">
          {t('rosterEncodingLabel')}{' '}
          <select
            value={encoding}
            disabled={state === 'loading' || state === 'applying'}
            onChange={(e) => {
              setEncoding(e.target.value)
              if (file) runPreview(file, e.target.value)
            }}
          >
            <option value="auto">{t('rosterEncodingAuto')}</option>
            <option value="tis-620">TIS-620 / Windows-874</option>
            <option value="utf-8">UTF-8</option>
          </select>
        </label>
      </div>
      {error && <p className="v2-field-error">{error}</p>}
      {done && <div className="v2-notice v2-notice-info" style={{ marginTop: 10 }}>{t('gradeImportDone', { cells: done.cells, rows: done.change })}</div>}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <p className="v2-subtext">
            {t('gradeImportSummary', {
              encoding: preview.encoding,
              columns: preview.matchedColumns.length,
              change: preview.counts.change,
              cells: preview.counts.cells,
              unchanged: preview.counts.unchanged,
              rejected: preview.counts.rejected,
            })}
          </p>
          {preview.unmappedBytes > 0 && <div className="v2-notice v2-notice-error">{t('rosterUnmapped', { n: preview.unmappedBytes })}</div>}
          {preview.unknownColumns.length > 0 && (
            <div className="v2-notice v2-notice-error">{t('gradeImportUnknownColumns', { columns: preview.unknownColumns.join(', ') })}</div>
          )}
          {preview.counts.selfEnteredId > 0 && (
            <div className="v2-notice v2-notice-error">{t('gradeImportSelfEnteredNotice', { n: preview.counts.selfEnteredId })}</div>
          )}
          {preview.ambiguousColumns.length > 0 && (
            <div className="v2-notice v2-notice-error">{t('gradeImportAmbiguousColumns', { columns: preview.ambiguousColumns.join(', ') })}</div>
          )}

          {changed.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto', marginTop: 8 }}>
              <table className="v2-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('colName')}</th>
                    <th>{t('colAssignment')}</th>
                    <th>{t('gradeImportColChange')}</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.flatMap((r) =>
                    r.changes.map((c) => (
                      <tr key={`${r.line}:${c.assignmentId}`}>
                        <td className="is-muted">{r.line}</td>
                        <td>
                          {r.displayName}
                          {r.selfEnteredId && <div className="v2-field-error" style={{ margin: 0 }}>{t('gradeImportSelfEnteredId')}</div>}
                        </td>
                        <td>{c.header}</td>
                        <td>
                          {formatPoints(c.from)} → <strong>{formatPoints(c.to)}</strong>
                          {c.overMax && <span className="is-muted" style={{ marginLeft: 6 }}>{t('gradeImportOverMax')}</span>}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}

          {rejected.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, fontSize: '.85rem' }}>{t('gradeImportRejectedHeading', { n: rejected.length })}</div>
              <table className="v2-table">
                <tbody>
                  {rejected.map((r) => (
                    <tr key={r.line}>
                      <td className="is-muted">{r.line}</td>
                      <td>{r.studentId ?? ''}</td>
                      <td className="is-muted">{r.email ?? ''}</td>
                      <td className="v2-field-error" style={{ margin: 0 }}>{reasonText(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.missing.length > 0 && (
            <p className="v2-field-hint">
              {t('gradeImportMissing', { n: preview.missing.length })}: {preview.missing.map((m) => m.displayName).join(', ')}
            </p>
          )}
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-secondary" disabled={state === 'applying'} onClick={reset}>
              {t('cancel')}
            </button>
            <button type="button" className="v2-btn v2-btn-primary" disabled={preview.counts.cells === 0 || state !== 'ready'} onClick={confirm}>
              {t('gradeImportConfirm', { n: preview.counts.cells })}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
