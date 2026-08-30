import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import { messageFor } from '../auth/messages.js'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

export default function RegisterPage() {
  const { register, resendVerification } = useV2Auth()
  const [form, setForm] = useState({ displayName: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (form.password.length < 12) return setError('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร')
    setBusy(true)
    try {
      await register(form.displayName, form.email, form.password)
      setSent(true)
    } catch (requestError) {
      setError(messageFor(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    setError('')
    try { await resendVerification(form.email); setSent(true) }
    catch (requestError) { setError(messageFor(requestError)) }
    finally { setBusy(false) }
  }

  return (
    <AuthCard title="สมัครสมาชิก" subtitle="ระบบจะส่งลิงก์ยืนยันผ่าน Brevo"
      footer={<>มีบัญชีแล้ว? <Link to="/login">เข้าสู่ระบบ</Link></>}>
      {error && <Notice kind="error">{error}</Notice>}
      {sent ? <>
        <Notice>หากอีเมลนี้สมัครได้ ระบบจะส่งลิงก์ยืนยันให้ กรุณาตรวจสอบ Inbox และ Spam</Notice>
        <button type="button" className="v2-secondary" onClick={resend} disabled={busy}>ส่งอีเมลยืนยันอีกครั้ง</button>
      </> : <form onSubmit={submit} className="v2-form">
        <label>ชื่อที่แสดง<input name="displayName" autoComplete="name" value={form.displayName} onChange={change} maxLength="100" required /></label>
        <label>อีเมล<input name="email" type="email" autoComplete="email" value={form.email} onChange={change} required /></label>
        <label>รหัสผ่าน<input name="password" type="password" autoComplete="new-password" value={form.password} onChange={change} minLength="12" maxLength="128" required /><small>อย่างน้อย 12 ตัวอักษร</small></label>
        <button type="submit" disabled={busy}>{busy ? 'กำลังสมัคร…' : 'สร้างบัญชี'}</button>
      </form>}
    </AuthCard>
  )
}
