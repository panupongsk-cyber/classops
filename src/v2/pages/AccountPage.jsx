import { useNavigate } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import Notice from '../components/Notice.jsx'

export default function AccountPage() {
  const { user, logout } = useV2Auth()
  const navigate = useNavigate()
  async function signOut() { await logout(); navigate('/login', { replace: true }) }

  return <main className="v2-auth-page">
    <section className="v2-auth-card v2-account">
      <div className="v2-brand">ClassOps <span>v2</span></div>
      <h1>สวัสดี {user.displayName}</h1>
      <p className="v2-subtitle">{user.email}</p>
      <Notice kind="success">บัญชีและอีเมลพร้อมใช้งานแล้ว</Notice>
      <Notice>ขณะนี้เป็นช่วงทดสอบระบบสมาชิก v2 ข้อมูลรายวิชาและสิทธิ์จาก Firebase ยังไม่ได้ย้ายเข้ามา</Notice>
      <button type="button" className="v2-secondary" onClick={signOut}>ออกจากระบบ</button>
    </section>
  </main>
}
