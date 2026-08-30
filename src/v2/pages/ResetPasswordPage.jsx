import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { messageFor } from '../auth/messages.js'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token'))
  const { resetPassword } = useV2Auth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(token ? '' : 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (token) window.history.replaceState({}, '', '/reset-password') }, [token])

  async function submit(event) {
    event.preventDefault()
    if (password.length < 12) return setError('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร')
    setBusy(true); setError('')
    try {
      await resetPassword(token, password)
      navigate('/login?password=reset', { replace: true })
    } catch (requestError) { setError(messageFor(requestError)) }
    finally { setBusy(false) }
  }

  return <AuthCard title="ตั้งรหัสผ่านใหม่" footer={<Link to="/login">กลับหน้าเข้าสู่ระบบ</Link>}>
    {error && <Notice kind="error">{error}</Notice>}
    {token && <form className="v2-form" onSubmit={submit}>
      <label>รหัสผ่านใหม่<input type="password" autoComplete="new-password" minLength="12" maxLength="128" value={password} onChange={(e) => setPassword(e.target.value)} required /><small>อย่างน้อย 12 ตัวอักษร</small></label>
      <button type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}</button>
    </form>}
  </AuthCard>
}
