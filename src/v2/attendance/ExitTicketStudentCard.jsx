import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { getOpenExitTicket, getOpenSession, submitExitTicketResponse } from './api.js'

const POLL_MS = 10000

export default function ExitTicketStudentCard({ sectionId }) {
  const { t } = useI18n()
  const [ticket, setTicket] = useState(undefined) // undefined = loading, null = none open
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const poll = useCallback(async () => {
    try {
      const openSessionResult = await getOpenSession(sectionId)
      if (!openSessionResult.session) { setTicket(null); return }
      const ticketResult = await getOpenExitTicket(openSessionResult.session.id)
      setTicket(ticketResult.exitTicket)
      if (ticketResult.myResponse) {
        setRating(ticketResult.myResponse.rating)
        setComment(ticketResult.myResponse.comment ?? '')
      }
    } catch {
      setTicket(null)
    }
  }, [sectionId])

  useEffect(() => {
    poll()
    const interval = setInterval(poll, POLL_MS)
    return () => clearInterval(interval)
  }, [poll])

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await submitExitTicketResponse(ticket.id, rating, comment.trim() || undefined)
      setSaved(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (!ticket) return null

  return (
    <div className="v2-card" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('exitTicketCardHeading')}</div>
      <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.85rem', margin: '0 0 12px' }}>{ticket.prompt}</p>
      <form onSubmit={handleSubmit}>
        <div className="v2-field">
          <label>{t('rateLabel')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => { setRating(value); setSaved(false) }}
                style={{
                  width: 40, height: 40, borderRadius: 10, cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700,
                  border: rating === value ? '2px solid var(--v2-primary)' : '1px solid var(--v2-border-strong)',
                  background: rating === value ? 'var(--v2-primary-tint)' : '#fff',
                  color: rating === value ? 'var(--v2-primary)' : 'var(--v2-ink)',
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <div className="v2-field">
          <label htmlFor="exit-ticket-comment">{t('commentLabel')}</label>
          <textarea
            id="exit-ticket-comment"
            value={comment}
            onChange={(e) => { setComment(e.target.value); setSaved(false) }}
            placeholder={t('commentPlaceholder')}
            rows={2}
            style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--v2-border-strong)', borderRadius: 10, fontFamily: 'inherit', fontSize: '.9rem' }}
          />
        </div>
        {saved && <p style={{ fontSize: '.78rem', color: 'var(--v2-ink-muted)', margin: '0 0 10px' }}>{t('responseSaved')}</p>}
        <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting || !rating}>{t('submitResponse')}</button>
      </form>
    </div>
  )
}
