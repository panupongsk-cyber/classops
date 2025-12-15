import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getClassrooms,
    getAllClassrooms,
    getActiveSession,
    createSession,
    endSession,
    subscribeToAttendance,
    subscribeToSession,
    getStudents,
    getAdminConfig,
    DEFAULT_CHECKIN_RADIUS,
    DEFAULT_QR_INTERVAL,
    DEFAULT_GRACE_PERIOD,
    DEFAULT_REQUIRE_GPS
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

    // Subscribe to attendance updates (real-time)
    useEffect(() => {
        if (!session?.id) {
            console.log('📡 No session ID, clearing attendance');
            setAttendance([]);
            return;
        }

        console.log('📡 Setting up attendance subscription for session:', session.id);
        const unsubscribe = subscribeToAttendance(session.id, (data) => {
            console.log('📡 Attendance data received:', data.length, 'records');
            setAttendance(data);
        });

        return () => {
            console.log('📡 Cleaning up attendance subscription');
            unsubscribe();
        };
    }, [session?.id]);

    const handleStartSession = async () => {
        if (!selectedClassroom) return;

        try {
            // Get admin config for check-in radius
            const config = await getAdminConfig();
            const checkInRadius = config.checkInRadius || DEFAULT_CHECKIN_RADIUS;

            // Get teacher's GPS location
            let location = null;
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    });
                });
                location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                console.log('📍 Teacher location:', location);
            } catch (gpsError) {
                console.warn('⚠️ Could not get GPS location:', gpsError.message);
                // Continue without GPS - session will not require location check
                alert('ไม่สามารถเข้าถึงตำแหน่ง GPS ได้ การเช็คชื่อจะไม่ตรวจสอบตำแหน่ง');
            }

            // Use qrInterval and gracePeriod from admin config
            const qrInterval = config.qrInterval || DEFAULT_QR_INTERVAL;
            const gracePeriod = config.gracePeriod || DEFAULT_GRACE_PERIOD;
            // Default to true if not present, false if strictly false
            const requireGPS = config.requireGPS !== false;

            const newSession = await createSession(selectedClassroom.id, qrInterval, location, checkInRadius, gracePeriod, requireGPS);
            setSession({
                id: newSession.id,
                classroomId: selectedClassroom.id,
                activeToken: newSession.token,
                activeEmoji: newSession.emojiSequence,
                tokenExpiry: newSession.expiry,
                isActive: true,
                qrInterval,
                gracePeriod,
                location,
                checkInRadius
            });
        } catch (error) {
            console.error('Failed to start session:', error);
            alert('ไม่สามารถเริ่มเซสชั่นได้: ' + error.message);
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
