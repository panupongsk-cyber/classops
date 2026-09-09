import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useV2Auth } from '../auth/V2AuthContext.jsx'
import AuthCard from '../components/AuthCard.jsx'
import Notice from '../components/Notice.jsx'

const oauthMessages = {
  invalid_state: 'คำขอ Google หมดอายุ กรุณาลองใหม่',
  unverified_email: 'Google ไม่ได้ยืนยันอีเมลของบัญชีนี้',
  account_link_required: 'อีเมลนี้มีบัญชีอยู่แล้วจากผู้ให้บริการอื่น กรุณาติดต่อผู้ดูแลระบบ',
  failed: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ',
}

export default function LoginPage() {
  const { user, refresh, startGoogleLogin } = useV2Auth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const oauth = params.get('oauth')

  useEffect(() => {
    if (user) navigate('/v2', { replace: true })
    if (oauth === 'success') refresh().then((currentUser) => {
      if (currentUser) navigate('/v2', { replace: true })
    }).catch(() => setError('ตรวจสอบ session จาก Google ไม่สำเร็จ'))
  }, [navigate, oauth, refresh, user])

  return (
    <AuthCard title="เข้าสู่ระบบ" subtitle="ใช้ได้กับทุกโดเมนอีเมล ไม่จำกัดเฉพาะ nu.ac.th">
      {(error || oauthMessages[oauth]) && <Notice kind="error">{error || oauthMessages[oauth]}</Notice>}
      <button className="v2-google" type="button" onClick={startGoogleLogin}>เข้าสู่ระบบด้วย Google</button>
    </AuthCard>
  )
}
