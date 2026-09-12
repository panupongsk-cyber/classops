import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { closeExitTicket, getExitTicketResponses, getOpenExitTicket, openExitTicket } from './api.js'

const POLL_MS = 6000

const panelStyle = { width: '100%', maxWidth: 500, background: 'rgba(255,255,255,.06)', borderRadius: 16, padding: 20, marginTop: 24 }
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)', color: '#fff' }
const btnStyle = { padding: '8px 16px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer' }

export default function ExitTicketPanel({ sessionId }) {
  const { t } = useI18n()
  const [ticket, setTicket] = useState(undefined) // undefined = loading, null = none open
  const [responses, setResponses] = useState([])
  const [prompt, setPrompt] = useState('')
  const [closedView, setClosedView] = useState(null) // { ticket, responses } after closing
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef(null)

  const poll = useCallback(async () => {
    const openResult = await getOpenExitTicket(sessionId)
    setTicket(openResult.exitTicket)
    if (openResult.exitTicket) {
      const responsesResult = await getExitTicketResponses(openResult.exitTicket.id)
      setResponses(responsesResult.responses)
    }
  }, [sessionId])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [poll])

  async function handleOpen(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await openExitTicket(sessionId, prompt.trim())
      setPrompt('')
      setClosedView(null)
      await poll()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleClose() {
    const responsesResult = await getExitTicketResponses(ticket.id)
    await closeExitTicket(ticket.id)
    setClosedView({ ticket, responses: responsesResult.responses })
    setTicket(null)
    setResponses([])
  }

  if (ticket === undefined) return null

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('exitTicketHeading')}</div>

      {!ticket && (
        <form onSubmit={handleOpen} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            style={inputStyle}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('exitTicketPromptPlaceholder')}
            required
          />
          <button type="submit" style={btnStyle} disabled={submitting}>{t('openExitTicketCta')}</button>
        </form>
      )}

      {ticket && (
        <>
          <p style={{ color: '#cbd5e1', margin: '0 0 10px' }}>{ticket.prompt}</p>
          <div style={{ fontSize: '.85rem', color: '#94a3b8', marginBottom: 10 }}>
            {t('exitTicketResponsesCount', { count: responses.length })}
          </div>
          <ResponseList responses={responses} t={t} />
          <button type="button" style={{ ...btnStyle, background: '#ef4444', marginTop: 12 }} onClick={handleClose}>
            {t('closeExitTicketCta')}
          </button>
        </>
      )}

      {!ticket && closedView && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.15)' }}>
          <p style={{ color: '#cbd5e1', margin: '0 0 8px' }}>{closedView.ticket.prompt}</p>
          <div style={{ fontSize: '.8rem', color: '#94a3b8', marginBottom: 8 }}>{t('exitTicketClosedLabel')}</div>
          <ResponseList responses={closedView.responses} t={t} />
        </div>
      )}
    </div>
  )
}

function ResponseList({ responses, t }) {
  if (responses.length === 0) return <p style={{ color: '#64748b', fontSize: '.85rem' }}>{t('exitTicketNoResponses')}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
      {responses.map((response) => (
        <div key={response.user_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '.85rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <span>{response.display_name}</span>
          <span style={{ fontWeight: 600 }}>{'★'.repeat(response.rating)}{'☆'.repeat(5 - response.rating)}</span>
          {response.comment && <span style={{ color: '#94a3b8', flex: 1, textAlign: 'right' }}>{response.comment}</span>}
        </div>
      ))}
    </div>
  )
}
