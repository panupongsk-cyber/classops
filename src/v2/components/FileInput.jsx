import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'

// A native <input type=file> behind a localized button and file-name label: the browser's own
// "Choose File / No file chosen" text is always in the browser's language, not the page's.
export default function FileInput({ accept, onChange, disabled, label, fileName }) {
  const { t } = useI18n()
  const [picked, setPicked] = useState('')
  const shown = fileName ?? picked
  return (
    <label className={`v2-file ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          setPicked(event.target.files?.[0]?.name ?? '')
          onChange?.(event)
        }}
      />
      <span className="v2-btn-sm v2-btn-outline" aria-hidden="true">{label}</span>
      <span className="v2-file-name">{shown || t('fileNoneChosen')}</span>
    </label>
  )
}
