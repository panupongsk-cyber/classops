import { Link } from 'react-router-dom'

export default function AuthCard({ title, subtitle, children, footer }) {
  return (
    <main className="v2-auth-page">
      <section className="v2-auth-card">
        <Link className="v2-brand" to="/">ClassOps <span>v2</span></Link>
        <h1>{title}</h1>
        {subtitle && <p className="v2-subtitle">{subtitle}</p>}
        {children}
        {footer && <div className="v2-footer">{footer}</div>}
      </section>
    </main>
  )
}
