# ClassOps - All-in-One Classroom Operating System

## Version 1.1.0 (April 2026)

ClassOps is a unified classroom management system designed to consolidate multiple platforms (LMS, Teams, Quizzes, Programming) into a single, interactive hub.

🌐 **Live:** [Your Deployment URL]

---

## ✨ Features

### 📰 Class Feed (New!)
- **Unified Timeline:** Replaces Teams/Moodle for announcements, resources, and assignments.
- **Rich Post Types:** Supports text announcements, file attachments (PDFs/Images), and interactive links.
- **Real-time Interaction:** Instant updates for students when a teacher posts new content.
- **Engagement:** Built-in "Likes" and "Comments" for contextual Q&A.

### 🎓 LMS & Attendance
- **Dynamic Roster:** Student management with easy enrollment.
- **Attendance System:** QR Code + Emoji Challenge + GPS-verified check-ins.
- **Exit Tickets:** Real-time feedback loop after every class session.
- **Random Picker:** Interactive student selection for classroom engagement.

### 📊 Grading & Analytics
- **Assignment Workflow:** Manage submissions and provide feedback directly in the app.
- **Gradebook:** Comprehensive view of student performance with CSV export.
- **Stats Dashboard:** Visual analytics for attendance and engagement.

---

## 🛠️ Tech Stack
- **Current frontend:** React + Vite
- **Legacy production backend:** Firebase Authentication + Firestore
- **ClassOps v2 foundation:** Fastify + TypeScript + PostgreSQL 16 + Brevo SMTP
- **Migration strategy:** Run v2 alongside Firebase until data migration and pilot acceptance are complete

---

## 🚀 Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/panupongsk-cyber/classops.git
   cd classops
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Firebase:**
   Create a `.env` file based on `.env.example` and add your Firebase project credentials.

4. **Run the development server:**
   ```bash
   npm run dev
   ```

## ClassOps v2 authentication foundation

The v2 server is under [`server/`](server/README.md). It provides self-hosted email registration, verification, password reset, sessions, an email outbox, and PostgreSQL migrations without changing the existing Firebase application. Start the local database with `npm run v2:db:up` and follow the server README.

The v2 authentication UI is isolated behind a build-time flag. To run it locally after starting the API and mail worker:

```bash
VITE_AUTH_MODE=v2 npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:3000`, keeping the browser session same-origin during development. `VITE_API_BASE_URL` can point to a separate API origin when required. The v2 UI currently covers registration, email verification, login, Google OAuth, logout, forgot-password, and reset-password only. Classroom data and roles remain in Firebase until the migration increment is complete.

The existing Firebase deployment remains the production system until a separate cutover is explicitly approved.

---

## 📝 Changelog

### v1.1.0 (2026-04-15)
- **Feature:** Introduced **Class Feed** for unified classroom communication.
- **Branding:** Rebranded from "Attendance" to **ClassOps**.
- **Security:** Moved Firebase configuration to environment variables.
- **UI:** Added navigation tabs for "Feed" and "Attendance" for both Teachers and Students.
