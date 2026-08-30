CREATE INDEX email_outbox_stale_sending_idx
  ON email_outbox (locked_at, id)
  WHERE status = 'sending';
