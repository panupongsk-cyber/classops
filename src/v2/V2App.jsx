import { Navigate, Route, Routes } from 'react-router-dom'
import { useV2Auth } from './auth/V2AuthContext.jsx'
import AppShell from './components/AppShell.jsx'
import AccountPage from './pages/AccountPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import AddSectionPage from './sections/AddSectionPage.jsx'
import CreateCoursePage from './sections/CreateCoursePage.jsx'
import SectionDetailPage from './sections/SectionDetailPage.jsx'
import SectionsPage from './sections/SectionsPage.jsx'

function ProtectedRoute({ children }) {
  const { user, loading } = useV2Auth()
  if (loading) return <main className="v2-auth-page"><p>กำลังตรวจสอบการเข้าสู่ระบบ…</p></main>
  return user ? children : <Navigate to="/login" replace />
}

function ShellRoute({ children }) {
  return <ProtectedRoute><AppShell>{children}</AppShell></ProtectedRoute>
}

export default function V2App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/v2/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
      <Route path="/v2/sections" element={<ShellRoute><SectionsPage /></ShellRoute>} />
      <Route path="/v2/sections/:sectionId" element={<ShellRoute><SectionDetailPage /></ShellRoute>} />
      <Route path="/v2/courses/new" element={<ShellRoute><CreateCoursePage /></ShellRoute>} />
      <Route path="/v2/courses/:courseId/sections/new" element={<ShellRoute><AddSectionPage /></ShellRoute>} />
      <Route path="/v2" element={<Navigate to="/v2/sections" replace />} />
      <Route path="*" element={<Navigate to="/v2/sections" replace />} />
    </Routes>
  )
}
