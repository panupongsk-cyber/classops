import { Navigate, Route, Routes } from 'react-router-dom'
import { useV2Auth } from './auth/V2AuthContext.jsx'
import AccountPage from './pages/AccountPage.jsx'
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'
import VerifyEmailPage from './pages/VerifyEmailPage.jsx'

function ProtectedRoute({ children }) {
  const { user, loading } = useV2Auth()
  if (loading) return <main className="v2-auth-page"><p>กำลังตรวจสอบการเข้าสู่ระบบ…</p></main>
  return user ? children : <Navigate to="/login" replace />
}

export default function V2App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/v2" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/v2" replace />} />
    </Routes>
  )
}
