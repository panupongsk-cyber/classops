import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

const oauthMessages = {
  invalid_state: 'คำขอเข้าสู่ระบบหมดอายุ กรุณาลองใหม่',
  unverified_email: 'ไม่พบอีเมลที่ยืนยันแล้วจากบัญชีนี้',
  email_registered_elsewhere: 'อีเมลนี้ลงทะเบียนไว้กับผู้ให้บริการอื่นแล้ว กรุณาเข้าสู่ระบบด้วยผู้ให้บริการเดิม',
  failed: 'เข้าสู่ระบบไม่สำเร็จ',
}

export default function LoginPage() {
  const { user, refresh, startGoogleLogin, startMicrosoftLogin } = useV2Auth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const oauth = params.get('oauth')

  useEffect(() => {
    if (user) navigate('/v2', { replace: true })
    if (oauth === 'success') refresh().then((currentUser) => {
      if (currentUser) navigate('/v2', { replace: true })
    }).catch(() => setError('ตรวจสอบ session ไม่สำเร็จ'))
  }, [navigate, oauth, refresh, user])

  return (
    <AuthCard title="เข้าสู่ระบบ" subtitle="ใช้ได้กับทุกโดเมนอีเมล ไม่จำกัดเฉพาะ nu.ac.th">
      {(error || oauthMessages[oauth]) && <Notice kind="error">{error || oauthMessages[oauth]}</Notice>}
      <button className="v2-google" type="button" onClick={startGoogleLogin}>เข้าสู่ระบบด้วย Google</button>
      <button className="v2-microsoft" type="button" onClick={startMicrosoftLogin}>เข้าสู่ระบบด้วย Microsoft</button>
    </AuthCard>
  )
}
