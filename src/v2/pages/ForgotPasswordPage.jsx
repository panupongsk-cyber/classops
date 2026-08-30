import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { messageFor } from '../auth/messages.js'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

export default function ForgotPasswordPage() {
  const { forgotPassword } = useV2Auth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault(); setBusy(true); setStatus('')
    try {
      await forgotPassword(email)
      setStatus('หากมีบัญชีนี้ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ทางอีเมล')
    } catch (error) { setStatus(messageFor(error)) }
    finally { setBusy(false) }
  }

  return <AuthCard title="ลืมรหัสผ่าน" footer={<Link to="/login">กลับหน้าเข้าสู่ระบบ</Link>}>
    {status && <Notice>{status}</Notice>}
    <form className="v2-form" onSubmit={submit}>
      <label>อีเมล<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}</button>
    </form>
  </AuthCard>
}
