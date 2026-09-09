import { Navigate, Route, Routes } from 'react-router-dom'
import { useV2Auth } from './auth/V2AuthContext.jsx'
import AccountPage from './pages/AccountPage.jsx'
import LoginPage from './pages/LoginPage.jsx'

function ProtectedRoute({ children }) {
  const { user, loading } = useV2Auth()
  if (loading) return <main className="v2-auth-page"><p>กำลังตรวจสอบการเข้าสู่ระบบ…</p></main>
  return user ? children : <Navigate to="/login" replace />
}

export default function V2App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/v2" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/v2" replace />} />
    </Routes>
  )
}
