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
- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Firebase (Auth, Firestore, Storage)
- **Real-time:** Firestore Listeners
- **Integration:** Deep-linking with **OmniQuizOps**

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

---

## 📝 Changelog

### v1.1.0 (2026-04-15)
- **Feature:** Introduced **Class Feed** for unified classroom communication.
- **Branding:** Rebranded from "Attendance" to **ClassOps**.
- **Security:** Moved Firebase configuration to environment variables.
- **UI:** Added navigation tabs for "Feed" and "Attendance" for both Teachers and Students.
