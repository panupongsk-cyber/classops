export default function Notice({ kind = 'info', children }) {
  return <div className={`v2-notice v2-notice-${kind}`} role="status">{children}</div>
}
