# ClassOps - Attendance Management System

## Version 1.0.0 (December 2024)

ระบบเช็คชื่อเข้าเรียนด้วย QR Code พร้อมระบบจัดการคะแนนสำหรับมหาวิทยาลัย

🌐 **Live:** https://attendance-13d17.web.app

---

## ✨ Features

### สำหรับผู้ดูแลระบบ (Admin)
- ✅ จัดการอาจารย์ (เพิ่ม/ลบ)
- ✅ ดูประวัติการเช็คชื่อทั้งระบบ
- ✅ ลบ session ใดก็ได้

### สำหรับอาจารย์ (Teacher)
- ✅ สร้าง/จัดการคลาสเรียน (รองรับหลายอาจารย์ต่อคลาส)
- ✅ จัดการรายชื่อนักศึกษา (เรียงตามชื่อ/รหัส)
- ✅ เปิด Session เช็คชื่อด้วย QR Code + Emoji Challenge + GPS
- ✅ สุ่มเลือกนักศึกษา (Random Name Picker)
- ✅ เพิ่ม/แก้ไขการเช็คชื่อหลัง Session (Manual Check-in/Leave)
- ✅ ระบบคะแนน (Grades) พร้อม Feedback และ Export CSV
- ✅ **Exit Ticket** - รับ feedback จากนักศึกษาหลังเรียน
  - เปิดอัตโนมัติเมื่อเริ่ม session
  - หมดเวลาใน 24 ชั่วโมง หรืออาจารย์ปิดก่อนได้
  - ดูสถิติ (avg rating, distribution) + Export CSV

### สำหรับนักศึกษา (Student)
- ✅ Scan QR เช็คชื่อ + Emoji Challenge
- ✅ ดูประวัติการเช็คชื่อ
- ✅ ดูคะแนน + feedback จากอาจารย์
- ✅ **ส่ง Exit Ticket** - ให้คะแนน 1-10 + ระบุเหตุผล + Key Takeaway

---

## 🛠️ Tech Stack
- **Frontend:** React + Vite
- **Backend:** Firebase (Auth, Firestore)
- **Hosting:** Firebase Hosting

---

## 📝 Changelog

### v1.0.0 (2024-12-17)
- Initial stable release
- Exit Ticket feature with hybrid UX (notification + history page)
- Auto-enabled exit ticket with 24hr deadline
- Multiple fixes for Firestore rules and queries
