import { Navigate, Route, Routes } from 'react-router-dom'
import { useV2Auth } from './auth/V2AuthContext.jsx'
import AppShell from './components/AppShell.jsx'
import AccountPage from './pages/AccountPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AttendancePage from './attendance/AttendancePage.jsx'
import CheckInLandingPage from './attendance/CheckInLandingPage.jsx'
import SessionLivePage from './attendance/SessionLivePage.jsx'
import FeedPage from './feed/FeedPage.jsx'
import AssignmentScoresPage from './gradebook/AssignmentScoresPage.jsx'
import GradebookPage from './gradebook/GradebookPage.jsx'
import AddSectionPage from './sections/AddSectionPage.jsx'
import CreateCoursePage from './sections/CreateCoursePage.jsx'
import SectionDetailPage from './sections/SectionDetailPage.jsx'
import SectionsPage from './sections/SectionsPage.jsx'
import AdminOverviewPage from './admin/AdminOverviewPage.jsx'
import AdminUsersPage from './admin/AdminUsersPage.jsx'
import AdminCoursesPage from './admin/AdminCoursesPage.jsx'
import AdminLiveSessionsPage from './admin/AdminLiveSessionsPage.jsx'
import AdminAuditLogsPage from './admin/AdminAuditLogsPage.jsx'
import { ForbiddenState } from './components/StateViews.jsx'
import StatsPage from './stats/StatsPage.jsx'
import ActivitiesPage from './activities/ActivitiesPage.jsx'
import AttemptPage from './activities/AttemptPage.jsx'
import EvidencePage from './activities/EvidencePage.jsx'
import PlayerPage from './activities/PlayerPage.jsx'
import PracticePage from './practice/PracticePage.jsx'
import PracticeProgressPage from './practice/PracticeProgressPage.jsx'
import PracticeRunPage from './practice/PracticeRunPage.jsx'

function ProtectedRoute({ children }) {
  const { user, loading } = useV2Auth()
  if (loading) return <main className="v2-auth-page"><p>กำลังตรวจสอบการเข้าสู่ระบบ…</p></main>
  return user ? children : <Navigate to="/login" replace />
}

function ShellRoute({ children }) {
  return <ProtectedRoute><AppShell>{children}</AppShell></ProtectedRoute>
}

function AdminRoute({ children }) {
  const { user, loading } = useV2Auth()
  if (loading) return <main className="v2-auth-page"><p>กำลังตรวจสอบการเข้าสู่ระบบ…</p></main>
  if (!user) return <Navigate to="/login" replace />
  if (!user.isPlatformAdmin) return <ShellRoute><ForbiddenState /></ShellRoute>
  return <ShellRoute>{children}</ShellRoute>
}

export default function V2App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/v2/checkin" element={<CheckInLandingPage />} />
      <Route path="/v2/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
      <Route path="/v2/sections" element={<ShellRoute><SectionsPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId" element={<ShellRoute><SectionDetailPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/attendance" element={<ShellRoute><AttendancePage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/attendance/live/:sessionId" element={<ProtectedRoute><SessionLivePage /></ProtectedRoute>} />
      <Route path="/v2/sections/:sectionId/gradebook" element={<ShellRoute><GradebookPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/gradebook/assignments/:assignmentId/scores" element={<ShellRoute><AssignmentScoresPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/feed" element={<ShellRoute><FeedPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/stats" element={<ShellRoute><StatsPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/activities" element={<ShellRoute><ActivitiesPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/activities/:activityId/play" element={<ShellRoute><PlayerPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/activities/:activityId/evidence" element={<ShellRoute><EvidencePage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/activities/attempts/:attemptId" element={<ShellRoute><AttemptPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/practice" element={<ShellRoute><PracticePage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/practice/attempts/:attemptId" element={<ShellRoute><PracticeRunPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId/practice/progress" element={<ShellRoute><PracticeProgressPage /></ShellRoute>} />
      <Route path="/v2/admin" element={<AdminRoute><AdminOverviewPage /></AdminRoute>} />
      <Route path="/v2/admin/users" element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
      <Route path="/v2/admin/courses" element={<AdminRoute><AdminCoursesPage /></AdminRoute>} />
      <Route path="/v2/admin/live" element={<AdminRoute><AdminLiveSessionsPage /></AdminRoute>} />
      <Route path="/v2/admin/audit" element={<AdminRoute><AdminAuditLogsPage /></AdminRoute>} />
      <Route path="/v2/courses/new" element={<ShellRoute><CreateCoursePage /></ShellRoute>} />
      <Route path="/v2/courses/:courseId/sections/new" element={<ShellRoute><AddSectionPage /></ShellRoute>} />
      <Route path="/v2" element={<Navigate to="/v2/sections" replace />} />
      <Route path="*" element={<Navigate to="/v2/sections" replace />} />
    </Routes>
  )
}
