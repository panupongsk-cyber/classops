import { insertIndent } from './helpers.js'

export default function CodeEditor({ value, onChange, label, rows = 14, readOnly = false }) {
  function onKeyDown(event) {
    if (event.key !== 'Tab' || event.shiftKey || readOnly) return
    event.preventDefault()
    const el = event.currentTarget
    const next = insertIndent(el.value, el.selectionStart, el.selectionEnd)
    onChange(next.value)
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = next.cursor })
  }
  return (
    <textarea
      className="v2-code-editor"
      aria-label={label}
      value={value}
      rows={rows}
      readOnly={readOnly}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
