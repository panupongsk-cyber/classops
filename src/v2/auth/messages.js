const errorMessages = {
  GOOGLE_OAUTH_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่า Google OAuth',
  REQUEST_FAILED: 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่',
}

export function messageFor(error) {
  if (error?.code === 'INVALID_REQUEST' && error.fields?.length) {
    return error.fields.map((field) => field.message).join(', ')
  }
  return errorMessages[error?.code] || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
}
