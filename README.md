# Attendance QR Code System

ระบบเช็คชื่อผู้เรียนด้วย QR Code แบบใช้ครั้งเดียว (One-Time QR Code)

## Features

- 🔐 **One-Time QR Code**: QR Code หมดอายุอัตโนมัติและใช้ได้ครั้งเดียวต่อนักศึกษา
- ⏱️ **Configurable Refresh**: ตั้งค่าระยะเวลารีเฟรช QR ได้ (10-120 วินาที)
- 📚 **Classroom Management**: สร้างและจัดการรายวิชา
- 👨‍🎓 **Student Registration**: ลงทะเบียนนักศึกษาด้วย Email
- 📱 **Mobile-Friendly**: ออกแบบสำหรับใช้งานบนมือถือ
- ⚡ **Real-time Updates**: อัพเดทรายชื่อผู้เข้าเรียนแบบ Real-time

## Getting Started

### 1. ติดตั้ง Dependencies

```bash
cd attendance
npm install
```

### 2. ตั้งค่า Firebase

1. ไปที่ [Firebase Console](https://console.firebase.google.com/)
2. สร้างโปรเจคใหม่
3. เปิดใช้งาน:
   - **Authentication** → Email/Password
   - **Firestore Database**
4. ไปที่ Project Settings → General → Your apps → เพิ่ม Web app
5. Copy config ไปใส่ใน `src/firebase/config.js`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. รันโปรเจค

```bash
npm run dev
```

เปิด http://localhost:5173

## การใช้งาน

### สำหรับอาจารย์

1. สมัครสมาชิกเลือก "อาจารย์"
2. ไปที่ **รายวิชา** → สร้างรายวิชาใหม่
3. ไปที่ **นักศึกษา** → เพิ่มนักศึกษา (ด้วย Email)
4. ไปที่ **ตั้งค่า** → ปรับระยะเวลา QR (ถ้าต้องการ)
5. ไปที่ **Dashboard** → กด "เริ่มเช็คชื่อ"

### สำหรับนักศึกษา

1. สมัครสมาชิกด้วย Email ที่อาจารย์ลงทะเบียนไว้
2. ไปที่ **Scan** → Scan QR Code ที่อาจารย์แสดง
3. ดูประวัติได้ที่ **ประวัติ**

## Deployment (Firebase Hosting)

```bash
# Build
npm run build

# Login Firebase
firebase login

# Deploy
firebase deploy
```

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Firebase (Auth, Firestore)
- **Hosting**: Firebase Hosting
- **Libraries**: qrcode.react, html5-qrcode
