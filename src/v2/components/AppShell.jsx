import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { getSection, listMemberships } from '../sections/api.js'
import LangToggle from './LangToggle.jsx'

const MANAGER_ROLES = ['owner', 'teacher', 'ta']

function initialFor(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

export default function AppShell({ children, sectionLabel }) {
  const { user, logout } = useV2Auth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isManager, setIsManager] = useState(null) // null = unknown/loading
  const [practiceEnabled, setPracticeEnabled] = useState(false)
  const navRef = useRef(null)

  const sectionMatch = location.pathname.match(/^\/v2\/sections\/([^/]+)/)
  const sectionId = sectionMatch?.[1]

  // A plain student can't use Attendance or Gradebook (manager-only per their product specs);
  // fetch the caller's own roles for the current Section once, rather than showing a nav item
  // that always 403s for them. GET /api/sections/:sectionId/memberships allows any member (not
  // manager-only), so this call itself never 403s for a student.
  useEffect(() => {
    if (!sectionId) { setIsManager(null); return }
    let cancelled = false
    listMemberships(sectionId).then((result) => {
      if (cancelled) return
      const mine = result.memberships.find((m) => m.user_id === user?.id)
      setIsManager(Boolean(user?.isPlatformAdmin) || Boolean(mine?.roles.some((role) => MANAGER_ROLES.includes(role))))
    }).catch(() => { if (!cancelled) setIsManager(false) })
    // Exam practice is opt-in per Section: students see the nav item only once it is enabled.
    getSection(sectionId).then((result) => { if (!cancelled) setPracticeEnabled(Boolean(result.section.practice_enabled)) }).catch(() => {})
    return () => { cancelled = true }
  }, [sectionId, user])

  // On a phone the nav is a horizontal strip; keep the current page's tab in view.
  useEffect(() => {
    // Horizontal only: scrollIntoView would also scroll the page vertically when this re-runs.
    const nav = navRef.current
    const active = nav?.querySelector('.v2-navitem.is-active')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    const left = active.offsetLeft - nav.offsetLeft
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - 12)
    }
  }, [location.pathname, isManager, practiceEnabled])

  async function signOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  const onMembershipRoute = /^\/v2\/sections\/[^/]+$/.test(location.pathname)
  const onAttendanceRoute = /^\/v2\/sections\/[^/]+\/attendance/.test(location.pathname)
  const onGradebookRoute = /^\/v2\/sections\/[^/]+\/gradebook/.test(location.pathname)
  const onFeedRoute = /^\/v2\/sections\/[^/]+\/feed/.test(location.pathname)
  const onStatsRoute = /^\/v2\/sections\/[^/]+\/stats/.test(location.pathname)
  const onActivitiesRoute = /^\/v2\/sections\/[^/]+\/activities/.test(location.pathname)

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
                {user?.isPlatformAdmin && (
                  <Link to="/v2/admin" onClick={() => setMenuOpen(false)} style={{ fontWeight: 600, color: 'var(--v2-primary)' }}>
                    ⚙️ {t('navAdminOverview')}
                  </Link>
                )}
                <Link to="/v2/account" onClick={() => setMenuOpen(false)}>{t('accountLink')}</Link>
                <button type="button" onClick={signOut}>{t('signOut')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="v2-body">
        <nav className="v2-sidenav" ref={navRef} aria-label={t('navSections')}>
          <Link to="/v2/sections" className={`v2-navitem ${location.pathname === '/v2/sections' ? 'is-active' : ''}`}>
            {t('navSections')}
          </Link>
          {sectionId ? (
            <>
              <Link to={`/v2/sections/${sectionId}`} className={`v2-navitem ${onMembershipRoute ? 'is-active' : ''}`}>
                {t('navMembership')}
              </Link>
              <Link to={`/v2/sections/${sectionId}/feed`} className={`v2-navitem ${onFeedRoute ? 'is-active' : ''}`}>
                {t('navFeed')}
              </Link>
              <Link to={`/v2/sections/${sectionId}/stats`} className={`v2-navitem ${onStatsRoute ? 'is-active' : ''}`}>
                {t('navStats')}
              </Link>
              <Link to={`/v2/sections/${sectionId}/activities`} className={`v2-navitem ${onActivitiesRoute ? 'is-active' : ''}`}>
                {t('navActivities')}
              </Link>
              {(isManager || practiceEnabled) && (
                <Link to={`/v2/sections/${sectionId}/practice`} className={`v2-navitem ${location.pathname.includes('/practice') ? 'is-active' : ''}`}>
                  {t('navPractice')}
                </Link>
              )}
              {isManager && (
                <>
                  <Link to={`/v2/sections/${sectionId}/attendance`} className={`v2-navitem ${onAttendanceRoute ? 'is-active' : ''}`}>
                    {t('navAttendance')}
                  </Link>
                  <Link to={`/v2/sections/${sectionId}/gradebook`} className={`v2-navitem ${onGradebookRoute ? 'is-active' : ''}`}>
                    {t('navGradebook')}
                  </Link>
                </>
              )}
            </>
          ) : (
            <>
              <div className="v2-navitem" style={{ opacity: 0.5 }}>{t('navMembership')}</div>
              <div className="v2-navhint">{t('navHint')}</div>
            </>
          )}

          {user?.isPlatformAdmin && (
            <div className="v2-nav-group" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--v2-border)' }}>
              <div className="v2-nav-group-header" style={{ fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--v2-ink-muted)', padding: '0 12px 8px' }}>
                {t('navAdminHeader')}
              </div>
              <Link
                to="/v2/admin"
                className={`v2-navitem ${location.pathname === '/v2/admin' ? 'is-active' : ''}`}
              >
                {t('navAdminOverview')}
              </Link>
              <Link
                to="/v2/admin/users"
                className={`v2-navitem ${location.pathname.startsWith('/v2/admin/users') ? 'is-active' : ''}`}
              >
                {t('navAdminUsers')}
              </Link>
              <Link
                to="/v2/admin/courses"
                className={`v2-navitem ${location.pathname.startsWith('/v2/admin/courses') ? 'is-active' : ''}`}
              >
                {t('navAdminCourses')}
              </Link>
              <Link
                to="/v2/admin/live"
                className={`v2-navitem ${location.pathname.startsWith('/v2/admin/live') ? 'is-active' : ''}`}
              >
                {t('navAdminLive')}
              </Link>
              <Link
                to="/v2/admin/audit"
                className={`v2-navitem ${location.pathname.startsWith('/v2/admin/audit') ? 'is-active' : ''}`}
              >
                {t('navAdminAudit')}
              </Link>
            </div>
          )}
        </nav>
        <div className="v2-content">{children}</div>
      </div>
    </div>
  )
}
