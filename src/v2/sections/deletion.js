import { ApiError } from '../auth/api.js'

// Resource keys answered by the server's guarded delete (`sectionDeletionBlockers`).
const BLOCKER_KEYS = {
  students: 'deleteBlocker_students',
  sessions: 'deleteBlocker_sessions',
  schedule: 'deleteBlocker_schedule',
  activities: 'deleteBlocker_activities',
  posts: 'deleteBlocker_posts',
  gradebook: 'deleteBlocker_gradebook',
  practiceAttempts: 'deleteBlocker_practiceAttempts',
  practiceAssignments: 'deleteBlocker_practiceAssignments',
  bookmarks: 'deleteBlocker_bookmarks',
  roster: 'deleteBlocker_roster',
}

export function blockerSummary(t, blockers) {
  return (blockers ?? [])
    .map((blocker) => `${t(BLOCKER_KEYS[blocker.resource] ?? 'deleteBlocker_other')} (${blocker.count})`)
    .join(', ')
}

export function sectionDeleteError(t, error) {
  if (error instanceof ApiError && error.code === 'SECTION_NOT_EMPTY') {
    return t('sectionDeleteBlocked', { items: blockerSummary(t, error.body?.blockers) })
  }
  return t('genericError')
}

export function courseDeleteError(t, error) {
  if (error instanceof ApiError && error.code === 'COURSE_NOT_EMPTY') {
    const names = (error.body?.sections ?? []).map(
      (section) => `${section.label} (${section.term})`,
    )
    return t('courseDeleteBlocked', { sections: names.join(', ') })
  }
  return t('genericError')
}
