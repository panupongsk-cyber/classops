import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';

// Admin Pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminTeachers from './pages/admin/Teachers';
import AttendanceHistory from './pages/admin/AttendanceHistory';

// Teacher Pages
import Dashboard from './pages/teacher/Dashboard';
import Classrooms from './pages/teacher/Classrooms';
import Students from './pages/teacher/Students';
import Settings from './pages/teacher/Settings';
import CourseDashboard from './pages/teacher/CourseDashboard';
import GradesPage from './pages/teacher/GradesPage';
import GroupsPage from './pages/teacher/GroupsPage';
import ClassroomHub from './pages/teacher/ClassroomHub';

// Student Pages
import ScanPage from './pages/student/ScanPage';
import History from './pages/student/History';
import CheckInPage from './pages/student/CheckInPage';
import StudentGrades from './pages/student/StudentGrades';
import StudentClassroomHub from './pages/student/ClassroomHub';

// Protected Route Component
function ProtectedRoute({ children, allowedRoles }) {
    const { user, userRole, loading } = useAuth();

    if (loading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh'
            }}>
                <p>กำลังโหลด...</p>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(userRole)) {
        // Redirect based on actual role
        if (userRole === 'admin') return <Navigate to="/admin" replace />;
        if (userRole === 'teacher') return <Navigate to="/teacher" replace />;
        if (userRole === 'student') return <Navigate to="/student" replace />;
        return <Navigate to="/login" replace />;
    }

    return children;
}

// Layout with Navbar
function AppLayout({ children }) {
    return (
        <>
            <Navbar />
            {children}
        </>
    );
}

// Get default route based on role
function getDefaultRoute(userRole) {
    switch (userRole) {
        case 'admin': return '/admin';
        case 'teacher': return '/teacher';
        case 'student': return '/student';
        default: return '/login';
    }
}

export default function App() {
    const { user, userRole, loading } = useAuth();

    if (loading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100vh',
                background: 'var(--bg-primary)'
            }}>
                <div className="text-center">
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>ClassOps</h1>
                    <p className="text-muted">กำลังโหลด...</p>
                </div>
            </div>
        );
    }

    return (
        <Routes>
            {/* Public Routes */}
            <Route
                path="/login"
                element={
                    user && userRole ? (
                        <Navigate to={getDefaultRoute(userRole)} replace />
                    ) : (
                        <LoginPage />
                    )
                }
            />

            {/* Check-in Route (Public - handles login internally) */}
            <Route
                path="/checkin"
                element={<CheckInPage />}
            />

            {/* Admin Routes */}
            <Route
                path="/admin"
                element={
                    <ProtectedRoute allowedRoles={['admin']}>
                        <AppLayout>
                            <AdminDashboard />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/teachers"
                element={
                    <ProtectedRoute allowedRoles={['admin']}>
                        <AppLayout>
                            <AdminTeachers />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/attendance"
                element={
                    <ProtectedRoute allowedRoles={['admin']}>
                        <AppLayout>
                            <AttendanceHistory />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />

            {/* Teacher Routes */}
            <Route
                path="/teacher"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <Dashboard />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/teacher/classrooms"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <Classrooms />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/teacher/students"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <Students />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/teacher/settings"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <Settings />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/teacher/course-stats"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <CourseDashboard />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/teacher/grades"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <GradesPage />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/teacher/groups"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <GroupsPage />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />

            <Route
                path="/teacher/class/:id"
                element={
                    <ProtectedRoute allowedRoles={['admin', 'teacher']}>
                        <AppLayout>
                            <ClassroomHub />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />

            {/* Student Routes */}
            <Route
                path="/student"
                element={
                    <ProtectedRoute allowedRoles={['student']}>
                        <AppLayout>
                            <History />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/student/class/:id"
                element={
                    <ProtectedRoute allowedRoles={['student']}>
                        <AppLayout>
                            <StudentClassroomHub />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/student/grades"
                element={
                    <ProtectedRoute allowedRoles={['student']}>
                        <AppLayout>
                            <StudentGrades />
                        </AppLayout>
                    </ProtectedRoute>
                }
            />

            {/* Default Route */}
            <Route
                path="*"
                element={
                    user && userRole ? (
                        <Navigate to={getDefaultRoute(userRole)} replace />
                    ) : (
                        <Navigate to="/login" replace />
                    )
                }
            />
        </Routes>
    );
}
