import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { messageFor } from '../auth/messages.js'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

const oauthMessages = {
  invalid_state: 'คำขอ Google หมดอายุ กรุณาลองใหม่',
  unverified_email: 'Google ไม่ได้ยืนยันอีเมลของบัญชีนี้',
  account_link_required: 'อีเมลนี้มีบัญชีแบบรหัสผ่านอยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน',
  failed: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ',
}

export default function LoginPage() {
  const { user, login, refresh, startGoogleLogin } = useV2Auth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const oauth = params.get('oauth')
  const passwordReset = params.get('password') === 'reset'

  useEffect(() => {
    if (user) navigate('/v2', { replace: true })
    if (oauth === 'success') refresh().then((currentUser) => {
      if (currentUser) navigate('/v2', { replace: true })
    }).catch(() => setError('ตรวจสอบ session จาก Google ไม่สำเร็จ'))
  }, [navigate, oauth, refresh, user])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate('/v2', { replace: true })
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="เข้าสู่ระบบ" subtitle="ใช้ได้กับทุกโดเมนอีเมล ไม่จำกัดเฉพาะ nu.ac.th"
      footer={<>ยังไม่มีบัญชี? <Link to="/register">สมัครสมาชิก</Link></>}>
      {(error || oauthMessages[oauth]) && <Notice kind="error">{error || oauthMessages[oauth]}</Notice>}
      {passwordReset && <Notice kind="success">ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้ง</Notice>}
      <button className="v2-google" type="button" onClick={startGoogleLogin}>เข้าสู่ระบบด้วย Google</button>
      <div className="v2-divider"><span>หรือ</span></div>
      <form onSubmit={submit} className="v2-form">
        <label>อีเมล<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <Link className="v2-small-link" to="/forgot-password">ลืมรหัสผ่าน?</Link>
        <button type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      </form>
    </AuthCard>
  )
}
