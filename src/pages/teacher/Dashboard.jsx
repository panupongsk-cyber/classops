import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getClassrooms,
    getAllClassrooms,
    getActiveSession,
    createSession,
    endSession,
    subscribeToAttendance,
    getStudents
} from '../../firebase/firestore';
import QRGenerator from '../../components/QRGenerator';
import AttendanceList from '../../components/AttendanceList';

export default function Dashboard() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [session, setSession] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [studentCount, setStudentCount] = useState(0);
    const [loading, setLoading] = useState(true);

    // Load classrooms
    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                // Admin sees all classrooms, teacher sees only their own
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid);

                console.log('📚 Dashboard loaded classrooms:', data.length);
                setClassrooms(data);
                if (data.length > 0 && !selectedClassroom) {
                    setSelectedClassroom(data[0]);
                }
            } catch (error) {
                console.error('Failed to load classrooms:', error);
            } finally {
                setLoading(false);
            }
        };
        loadClassrooms();
    }, [user?.uid, userRole]);

    // Load active session and student count for selected classroom
    useEffect(() => {
        const loadSessionData = async () => {
            if (!selectedClassroom?.id) return;

            try {
                const activeSession = await getActiveSession(selectedClassroom.id);
                setSession(activeSession);

                const students = await getStudents(selectedClassroom.id);
                setStudentCount(students.length);
            } catch (error) {
                console.error('Failed to load session:', error);
            }
        };
        loadSessionData();
    }, [selectedClassroom?.id]);

    // Subscribe to attendance updates
    useEffect(() => {
        if (!session?.id) {
            setAttendance([]);
            return;
        }

        const unsubscribe = subscribeToAttendance(session.id, (data) => {
            setAttendance(data);
        });

        return () => unsubscribe();
    }, [session?.id]);

    const handleStartSession = async () => {
        if (!selectedClassroom) return;

        try {
            const qrInterval = selectedClassroom.qrInterval || 30;
            const newSession = await createSession(selectedClassroom.id, qrInterval);
            setSession({
                id: newSession.id,
                classroomId: selectedClassroom.id,
                activeToken: newSession.token,
                tokenExpiry: newSession.expiry,
                isActive: true,
                qrInterval
            });
        } catch (error) {
            console.error('Failed to start session:', error);
        }
    };

    const handleEndSession = async () => {
        if (!session?.id) return;

        try {
            await endSession(session.id);
            setSession(null);
            setAttendance([]);
        } catch (error) {
            console.error('Failed to end session:', error);
        }
    };

    if (loading) {
        return (
            <div className="page container">
                <div className="text-center" style={{ padding: '4rem' }}>
                    <p>กำลังโหลด...</p>
                </div>
            </div>
        );
    }

    if (classrooms.length === 0) {
        return (
            <div className="page container">
                <div className="card text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, margin: '0 auto 1rem' }}>
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                    <h2>ยังไม่มีรายวิชา</h2>
                    <p className="text-muted mb-lg">สร้างรายวิชาแรกของคุณเพื่อเริ่มเช็คชื่อ</p>
                    <a href="/teacher/classrooms" className="btn btn-primary">
                        + สร้างรายวิชา
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="page container">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 'var(--space-xl)', alignItems: 'start' }}>
                {/* Main Content */}
                <div>
                    {/* Header */}
                    <div className="flex justify-between items-center mb-lg">
                        <div>
                            <h1 style={{ marginBottom: '0.25rem' }}>เช็คชื่อ</h1>
                            <p className="text-muted">เปิดเซสชั่นเพื่อให้นักศึกษา scan QR code</p>
                        </div>

                        {/* Classroom Selector */}
                        <select
                            className="form-input form-select"
                            value={selectedClassroom?.id || ''}
                            onChange={(e) => {
                                const classroom = classrooms.find(c => c.id === e.target.value);
                                setSelectedClassroom(classroom);
                                setSession(null);
                            }}
                            style={{ width: 'auto', minWidth: '200px' }}
                        >
                            {classrooms.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name} {c.code ? `(${c.code})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Stats */}
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-value">{attendance.length}</div>
                            <div className="stat-label">เช็คชื่อแล้ว</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{studentCount}</div>
                            <div className="stat-label">นักศึกษาทั้งหมด</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">
                                {studentCount > 0 ? Math.round((attendance.length / studentCount) * 100) : 0}%
                            </div>
                            <div className="stat-label">อัตราการเข้าเรียน</div>
                        </div>
                    </div>

                    {/* QR Code Section */}
                    <div className="card">
                        {session?.isActive ? (
                            <>
                                <div className="card-header">
                                    <div>
                                        <h3 className="card-title">กำลังเช็คชื่อ</h3>
                                        <div style={{
                                            display: 'inline-block',
                                            padding: '0.25rem 0.75rem',
                                            background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                                            borderRadius: 'var(--radius-full)',
                                            fontSize: '0.9rem',
                                            fontWeight: 500,
                                            marginTop: '0.5rem'
                                        }}>
                                            📚 {selectedClassroom?.name} {selectedClassroom?.code ? `(${selectedClassroom.code})` : ''}
                                        </div>
                                    </div>
                                    <button className="btn btn-danger" onClick={handleEndSession}>
                                        ปิดการเช็คชื่อ
                                    </button>
                                </div>
                                <div className="flex justify-center">
                                    <QRGenerator
                                        session={session}
                                        qrInterval={selectedClassroom?.qrInterval || 30}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="text-center" style={{ padding: '3rem' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, margin: '0 auto 1rem' }}>
                                    <rect x="3" y="3" width="7" height="7" rx="1" />
                                    <rect x="14" y="3" width="7" height="7" rx="1" />
                                    <rect x="3" y="14" width="7" height="7" rx="1" />
                                    <rect x="14" y="14" width="7" height="7" rx="1" />
                                </svg>
                                <h3 className="mb-md">พร้อมเปิดเช็คชื่อ</h3>
                                <p className="text-muted mb-lg">
                                    กดปุ่มด้านล่างเพื่อสร้าง QR Code ให้นักศึกษา scan
                                </p>
                                <button className="btn btn-primary btn-lg" onClick={handleStartSession}>
                                    เริ่มเช็คชื่อ
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar - Attendance List */}
                <div className="card" style={{ position: 'sticky', top: '100px' }}>
                    <div className="card-header">
                        <h3 className="card-title">ผู้เข้าเรียน ({attendance.length})</h3>
                    </div>
                    <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                        <AttendanceList attendance={attendance} />
                    </div>
                </div>
            </div>
        </div>
    );
}
