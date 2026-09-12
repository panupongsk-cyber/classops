import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import LangToggle from './LangToggle.jsx'

function initialFor(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

export default function AppShell({ children, sectionLabel }) {
  const { user, logout } = useV2Auth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  async function signOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  const sectionMatch = location.pathname.match(/^\/v2\/sections\/([^/]+)/)
  const sectionId = sectionMatch?.[1]
  const onMembershipRoute = /^\/v2\/sections\/[^/]+$/.test(location.pathname)
  const onAttendanceRoute = /^\/v2\/sections\/[^/]+\/attendance/.test(location.pathname)

  return (
    <div className="v2-app">
      <div className="v2-topbar">
        <Link to="/v2/sections" className="v2-brand">ClassOps <span className="v2-brand-pill">v2</span></Link>
        <div className="v2-section-switcher">{sectionLabel ?? t('navSections')}</div>
        <div className="v2-topbar-right">
          <LangToggle />
          <div className="v2-account-menu">
            <button type="button" className="v2-account-menu-trigger" onClick={() => setMenuOpen((open) => !open)}>
              <span className="v2-avatar">{initialFor(user?.displayName)}</span>
            </button>
            {menuOpen && (
              <div className="v2-account-menu-panel" onMouseLeave={() => setMenuOpen(false)}>
                <div className="v2-account-menu-email">{user?.email}</div>
                <Link to="/v2/account" onClick={() => setMenuOpen(false)}>{t('accountLink')}</Link>
                <button type="button" onClick={signOut}>{t('signOut')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="v2-body">
        <div className="v2-sidenav">
          <Link to="/v2/sections" className={`v2-navitem ${location.pathname === '/v2/sections' ? 'is-active' : ''}`}>
            {t('navSections')}
          </Link>
          {sectionId ? (
            <>
              <Link to={`/v2/sections/${sectionId}`} className={`v2-navitem ${onMembershipRoute ? 'is-active' : ''}`}>
                {t('navMembership')}
              </Link>
              <Link to={`/v2/sections/${sectionId}/attendance`} className={`v2-navitem ${onAttendanceRoute ? 'is-active' : ''}`}>
                {t('navAttendance')}
              </Link>
            </>
          ) : (
            <>
              <div className="v2-navitem" style={{ opacity: 0.5 }}>{t('navMembership')}</div>
              <div className="v2-navitem" style={{ opacity: 0.5 }}>{t('navAttendance')}</div>
              <div className="v2-navhint">{t('navHint')}</div>
            </>
          )}
        </div>
        <div className="v2-content">{children}</div>
      </div>
    </div>
  )
}
