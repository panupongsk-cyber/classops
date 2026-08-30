import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../auth/api.js'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const started = useRef(false)
  const [state, setState] = useState(token ? 'loading' : 'invalid')

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    window.history.replaceState({}, '', '/verify-email')
    apiRequest('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('success')).catch(() => setState('invalid'))
  }, [token])

  return <AuthCard title="ยืนยันอีเมล" footer={<Link to="/login">ไปหน้าเข้าสู่ระบบ</Link>}>
    {state === 'loading' && <Notice>กำลังตรวจสอบลิงก์…</Notice>}
    {state === 'success' && <Notice kind="success">ยืนยันอีเมลสำเร็จแล้ว คุณเข้าสู่ระบบได้ทันที</Notice>}
    {state === 'invalid' && <Notice kind="error">ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว</Notice>}
  </AuthCard>
}
