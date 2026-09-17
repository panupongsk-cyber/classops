import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { listAdminCourses, listAdminUsers, reassignSectionOwner, resetSectionJoinCode } from './api.js'

export default function AdminCoursesPage() {
  const { t } = useI18n()

  const [courses, setCourses] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Search & filter
  const [search, setSearch] = useState('')
  const [selectedTerm, setSelectedTerm] = useState('all')

  // Copied join code feedback: { [sectionId]: boolean }
  const [copiedMap, setCopiedMap] = useState({})

  // Modal states
  const [resetModalSection, setResetModalSection] = useState(null) // { section, course }
  const [ownerModalSection, setOwnerModalSection] = useState(null) // { section, course }

  const [candidateUsers, setCandidateUsers] = useState([])
  const [candidateUsersLoading, setCandidateUsersLoading] = useState(false)
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState('')

  const [modalPending, setModalPending] = useState(false)
  const [modalError, setModalError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const result = await listAdminCourses()
      setCourses(result.courses || [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Extract all distinct terms across all sections for filter dropdown
  const allTerms = useMemo(() => {
    if (!courses) return []
    const terms = new Set()
    for (const c of courses) {
      for (const s of c.sections || []) {
        if (s.term) terms.add(s.term)
      }
    }
    return Array.from(terms).sort().reverse()
  }, [courses])

  // Filtered courses and sections
  const filteredCourses = useMemo(() => {
    if (!courses) return []
    const q = search.trim().toLowerCase()

    return courses
      .map((course) => {
        const matchesCourse =
          !q ||
          course.code.toLowerCase().includes(q) ||
          course.title.toLowerCase().includes(q)

        const matchingSections = (course.sections || []).filter((sec) => {
          const matchesTerm = selectedTerm === 'all' || sec.term === selectedTerm
          if (!matchesTerm) return false
          if (matchesCourse) return true
          return (
            sec.label.toLowerCase().includes(q) ||
            sec.joinCode.toLowerCase().includes(q) ||
            (sec.owner?.displayName && sec.owner.displayName.toLowerCase().includes(q)) ||
            (sec.owner?.email && sec.owner.email.toLowerCase().includes(q))
          )
        })

        if (!matchesCourse && matchingSections.length === 0) return null

        return {
          ...course,
          sections: matchingSections,
        }
      })
      .filter(Boolean)
  }, [courses, search, selectedTerm])

  const totalSectionsCount = useMemo(() => {
    return filteredCourses.reduce((sum, c) => sum + (c.sections?.length || 0), 0)
  }, [filteredCourses])

  async function handleCopyJoinCode(sectionId, code) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedMap((prev) => ({ ...prev, [sectionId]: true }))
      setTimeout(() => {
        setCopiedMap((prev) => ({ ...prev, [sectionId]: false }))
      }, 2000)
    } catch {
      // Fallback
    }
  }

  function openResetModal(course, section) {
    setResetModalSection({ course, section })
    setModalError(null)
  }

  async function executeResetJoinCode() {
    if (!resetModalSection) return
    setModalPending(true)
    setModalError(null)
    try {
      const res = await resetSectionJoinCode(resetModalSection.section.id)
      // Update locally
      setCourses((prev) =>
        prev.map((c) => ({
          ...c,
          sections: (c.sections || []).map((s) =>
            s.id === resetModalSection.section.id ? { ...s, joinCode: res.joinCode } : s
          ),
        }))
      )
      setResetModalSection(null)
    } catch (err) {
      setModalError(err?.message || t('adminActionErrorGeneric'))
    } finally {
      setModalPending(false)
    }
  }

  async function openOwnerModal(course, section) {
    setOwnerModalSection({ course, section })
    setSelectedOwnerUserId(section.owner?.id || '')
    setModalError(null)
    setCandidateUsersLoading(true)
    try {
      const usersRes = await listAdminUsers({ limit: 100 })
      const activeUsers = (usersRes.users || []).filter((u) => u.status === 'active')
      setCandidateUsers(activeUsers)
      if (!section.owner?.id && activeUsers.length > 0) {
        setSelectedOwnerUserId(activeUsers[0].id)
      }
    } catch {
      setModalError(t('adminActionErrorGeneric'))
    } finally {
      setCandidateUsersLoading(false)
    }
  }

  async function executeReassignOwner() {
    if (!ownerModalSection || !selectedOwnerUserId) return
    setModalPending(true)
    setModalError(null)
    try {
      const res = await reassignSectionOwner(ownerModalSection.section.id, selectedOwnerUserId)
      // Update locally
      setCourses((prev) =>
        prev.map((c) => ({
          ...c,
          sections: (c.sections || []).map((s) =>
            s.id === ownerModalSection.section.id ? { ...s, owner: res.newOwner } : s
          ),
        }))
      )
      setOwnerModalSection(null)
    } catch (err) {
      setModalError(err?.message || t('adminActionErrorGeneric'))
    } finally {
      setModalPending(false)
    }
  }

  return (
    <div className="v2-admin-page">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to="/v2/admin" style={{ fontSize: '.85rem', color: 'var(--v2-primary)' }}>
              &larr; {t('adminBackToOverview')}
            </Link>
          </div>
          <h1 className="v2-h1" style={{ margin: '6px 0 0' }}>{t('adminCoursesTitle')}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
            {t('adminCoursesSubtitle')}
          </p>
        </div>
        <Link to="/v2/courses/new" className="v2-btn v2-btn-primary">
          + {t('createCourseHeading')}
        </Link>
      </div>

      {/* Filter toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="v2-input"
          style={{ flex: 1, minWidth: 260 }}
          placeholder={t('adminCoursesSearchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>{t('adminFilterTerm')}:</span>
          <select
            className="v2-select"
            value={selectedTerm}
            onChange={(e) => setSelectedTerm(e.target.value)}
          >
            <option value="all">{t('adminTermAll')}</option>
            {allTerms.map((term) => (
              <option key={term} value={term}>{term}</option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)', marginLeft: 'auto' }}>
          {t('adminTotalCoursesCount', { count: filteredCourses.length })} • {t('adminTotalSectionsCount', { count: totalSectionsCount })}
        </div>
      </div>

      {/* Content */}
      {loading && <LoadingRows rows={5} />}
      {error && !loading && <RetryableError onRetry={load} />}

      {!loading && !error && filteredCourses.length === 0 && (
        <div className="v2-card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--v2-ink-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>📚</div>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500 }}>{t('adminNoCoursesFound')}</p>
        </div>
      )}

      {!loading && !error && filteredCourses.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {filteredCourses.map((course) => (
            <div key={course.id} className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Course Header */}
              <div
                style={{
                  padding: '16px 20px',
                  background: 'var(--v2-surface-alt, #f8fafc)',
                  borderBottom: '1px solid var(--v2-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      fontSize: '1rem',
                      background: 'var(--v2-primary-subtle, #e0f2fe)',
                      color: 'var(--v2-primary)',
                      padding: '4px 8px',
                      borderRadius: 4,
                    }}
                  >
                    {course.code}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>{course.title}</span>
                  <span
                    style={{
                      fontSize: '.75rem',
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'var(--v2-border)',
                      color: 'var(--v2-ink-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    {course.type}
                  </span>
                </div>
                <Link
                  to={`/v2/courses/${course.id}/sections/new`}
                  className="v2-btn v2-btn-sm v2-btn-secondary"
                  style={{ fontSize: '.8rem' }}
                >
                  + {t('addSectionCta')}
                </Link>
              </div>

              {/* Sections Table */}
              {(!course.sections || course.sections.length === 0) ? (
                <div style={{ padding: '20px', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
                  {t('sectionsEmptyAdminHeading')}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--v2-border)', color: 'var(--v2-ink-muted)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        <th style={{ padding: '10px 20px' }}>{t('termLabelSemester')}</th>
                        <th style={{ padding: '10px 16px' }}>{t('sectionLabelField')}</th>
                        <th style={{ padding: '10px 16px' }}>{t('joinCodeLabel')}</th>
                        <th style={{ padding: '10px 16px' }}>{t('adminSectionOwner')}</th>
                        <th style={{ padding: '10px 16px' }}>{t('colRoles')}</th>
                        <th style={{ padding: '10px 20px', textAlign: 'right' }}>{t('adminColActions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {course.sections.map((sec) => (
                        <tr key={sec.id} style={{ borderBottom: '1px solid var(--v2-border)' }}>
                          {/* Term */}
                          <td style={{ padding: '12px 20px', fontWeight: 600 }}>
                            {sec.term}
                          </td>
                          {/* Label */}
                          <td style={{ padding: '12px 16px', color: 'var(--v2-ink-muted)' }}>
                            {sec.label}
                          </td>
                          {/* Join Code */}
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '.85rem' }}>
                                {sec.joinCode}
                              </code>
                              <button
                                type="button"
                                className="v2-btn v2-btn-sm"
                                style={{ padding: '2px 8px', fontSize: '.75rem' }}
                                onClick={() => handleCopyJoinCode(sec.id, sec.joinCode)}
                              >
                                {copiedMap[sec.id] ? t('copied') : t('copy')}
                              </button>
                              <button
                                type="button"
                                className="v2-btn v2-btn-sm"
                                style={{ padding: '2px 8px', fontSize: '.75rem', color: 'var(--v2-warning, #d97706)' }}
                                title={t('adminResetJoinCode')}
                                onClick={() => openResetModal(course, sec)}
                              >
                                🔄
                              </button>
                            </div>
                          </td>
                          {/* Owner */}
                          <td style={{ padding: '12px 16px' }}>
                            {sec.owner ? (
                              <div>
                                <div style={{ fontWeight: 500 }}>{sec.owner.displayName}</div>
                                <div style={{ fontSize: '.75rem', color: 'var(--v2-ink-muted)' }}>{sec.owner.email}</div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--v2-danger)', fontSize: '.8rem' }}>{t('adminSectionNoOwner')}</span>
                            )}
                          </td>
                          {/* Enrolled Students Count */}
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>
                              {t('adminSectionStudents', { count: sec.studentCount ?? 0 })}
                            </span>
                          </td>
                          {/* Actions */}
                          <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 8 }}>
                              <button
                                type="button"
                                className="v2-btn v2-btn-sm v2-btn-secondary"
                                style={{ fontSize: '.75rem', padding: '4px 10px' }}
                                onClick={() => openOwnerModal(course, sec)}
                              >
                                👤 {t('adminChangeOwner')}
                              </button>
                              <Link
                                to={`/v2/sections/${sec.id}`}
                                className="v2-btn v2-btn-sm v2-btn-primary"
                                style={{ fontSize: '.75rem', padding: '4px 10px' }}
                              >
                                {t('adminEnterSection')} &rarr;
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: Reset Join Code */}
      {resetModalSection && (
        <div className="v2-modal-backdrop" onClick={() => !modalPending && setResetModalSection(null)}>
          <div className="v2-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h2 className="v2-h2" style={{ margin: '0 0 8px' }}>{t('adminModalResetCodeTitle')}</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
              {t('adminModalResetCodeBody', {
                course: resetModalSection.course.code,
                term: resetModalSection.section.term,
                label: resetModalSection.section.label,
              })}
            </p>
            {modalError && (
              <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #f87171', borderRadius: 6, color: '#b91c1c', fontSize: '.85rem', marginBottom: 14 }}>
                {modalError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="v2-btn v2-btn-secondary"
                disabled={modalPending}
                onClick={() => setResetModalSection(null)}
              >
                {t('adminModalCancel')}
              </button>
              <button
                type="button"
                className="v2-btn v2-btn-danger"
                disabled={modalPending}
                onClick={executeResetJoinCode}
              >
                {modalPending ? t('adminModalProcessing') : t('adminResetJoinCode')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reassign Section Owner */}
      {ownerModalSection && (
        <div className="v2-modal-backdrop" onClick={() => !modalPending && setOwnerModalSection(null)}>
          <div className="v2-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 className="v2-h2" style={{ margin: '0 0 8px' }}>{t('adminModalChangeOwnerTitle')}</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--v2-ink-muted)', fontSize: '.9rem' }}>
              {t('adminModalChangeOwnerBody', {
                course: `${ownerModalSection.course.code} (${ownerModalSection.section.term} - ${ownerModalSection.section.label})`,
              })}
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '.85rem', fontWeight: 600, marginBottom: 6 }}>
                {t('adminChangeOwnerSelectLabel')}:
              </label>
              {candidateUsersLoading ? (
                <div style={{ fontSize: '.85rem', color: 'var(--v2-ink-muted)' }}>{t('loading')}</div>
              ) : (
                <select
                  className="v2-select"
                  style={{ width: '100%' }}
                  value={selectedOwnerUserId}
                  onChange={(e) => setSelectedOwnerUserId(e.target.value)}
                >
                  {candidateUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({u.email}) {u.isPlatformAdmin ? '[Admin]' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {modalError && (
              <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #f87171', borderRadius: 6, color: '#b91c1c', fontSize: '.85rem', marginBottom: 14 }}>
                {modalError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="v2-btn v2-btn-secondary"
                disabled={modalPending}
                onClick={() => setOwnerModalSection(null)}
              >
                {t('adminModalCancel')}
              </button>
              <button
                type="button"
                className="v2-btn v2-btn-primary"
                disabled={modalPending || !selectedOwnerUserId}
                onClick={executeReassignOwner}
              >
                {modalPending ? t('adminModalProcessing') : t('adminModalConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
