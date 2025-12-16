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
    manualCheckIn,
    recordLeave,
    updateSessionLocation,
    DEFAULT_CHECKIN_RADIUS,
    DEFAULT_QR_INTERVAL,
    DEFAULT_GRACE_PERIOD,
    DEFAULT_REQUIRE_GPS
} from '../../firebase/firestore';
import QRGenerator from '../../components/QRGenerator';
import AttendanceList from '../../components/AttendanceList';
import ManualCheckInModal from '../../components/ManualCheckInModal';
import StartSessionModal from '../../components/StartSessionModal';

export default function Dashboard() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [session, setSession] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [studentCount, setStudentCount] = useState(0);
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showManualModal, setShowManualModal] = useState(false);
    const [showStartModal, setShowStartModal] = useState(false);
    const [adminConfig, setAdminConfig] = useState(null);
    const [updatingLocation, setUpdatingLocation] = useState(false);

    // Load classrooms
    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                // Admin sees all classrooms, teacher sees only their own
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid, user.email);

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

                const studentsData = await getStudents(selectedClassroom.id);
                setStudents(studentsData);
                setStudentCount(studentsData.length);
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

    const handleStartSession = async ({ useGPS, location }) => {
        if (!selectedClassroom) return;

        try {
            const config = adminConfig || await getAdminConfig();
            const checkInRadius = config.checkInRadius || DEFAULT_CHECKIN_RADIUS;
            const qrInterval = selectedClassroom.qrInterval || config.qrInterval || DEFAULT_QR_INTERVAL;
            const gracePeriod = config.gracePeriod || DEFAULT_GRACE_PERIOD;

            const newSession = await createSession(
                selectedClassroom.id,
                qrInterval,
                useGPS ? location : null,
                checkInRadius,
                gracePeriod,
                useGPS
            );

            setSession({
                id: newSession.id,
                classroomId: selectedClassroom.id,
                activeToken: newSession.token,
                activeEmoji: newSession.emojiSequence,
                tokenExpiry: newSession.expiry,
                isActive: true,
                qrInterval,
                gracePeriod,
                requireGPS: useGPS,
                location: useGPS ? location : null,
                checkInRadius
            });
        } catch (error) {
            console.error('Failed to start session:', error);
            throw error;
        }
    };

    const handleUpdateLocation = async () => {
        if (!session?.id) return;

        setUpdatingLocation(true);
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0
                });
            });

            const location = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };

            const config = adminConfig || await getAdminConfig();
            const checkInRadius = config.checkInRadius || DEFAULT_CHECKIN_RADIUS;

            await updateSessionLocation(session.id, location, checkInRadius);

            setSession(prev => ({
                ...prev,
                location,
                requireGPS: true
            }));

            alert(`✅ อัพเดทตำแหน่งสำเร็จ!\n\nพิกัด: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`);
        } catch (error) {
            console.error('Failed to update location:', error);
            alert('ไม่สามารถอัพเดทตำแหน่งได้: ' + error.message);
        } finally {
            setUpdatingLocation(false);
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

    const handleManualCheckIn = async (student) => {
        if (!session?.id) return;
        await manualCheckIn(
            session.id,
            student,
            selectedClassroom?.name || '',
            user?.email || ''
        );
    };

    const handleRecordLeave = async (student, reason) => {
        if (!session?.id) return;
        await recordLeave(
            session.id,
            student,
            selectedClassroom?.name || '',
            reason,
            user?.email || ''
        );
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
                                    <div className="flex gap-sm">
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => setShowManualModal(true)}
                                        >
                                            ➕ เช็คชื่อ/ลา
                                        </button>
                                        <button className="btn btn-danger" onClick={handleEndSession}>
                                            ปิดการเช็คชื่อ
                                        </button>
                                    </div>
                                </div>
                                <div className="flex justify-center">
                                    <QRGenerator
                                        session={session}
                                        qrInterval={selectedClassroom?.qrInterval || 30}
                                    />
                                </div>

                                {/* GPS Status */}
                                <div style={{
                                    marginTop: 'var(--space-lg)',
                                    padding: 'var(--space-md)',
                                    background: 'var(--bg-glass)',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: 'var(--space-sm)'
                                }}>
                                    <div>
                                        {session?.requireGPS && session?.location ? (
                                            <>
                                                <span style={{ color: 'var(--success)' }}>📍 GPS: เปิดใช้งาน</span>
                                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                    พิกัด: {session.location.latitude.toFixed(5)}, {session.location.longitude.toFixed(5)}
                                                </div>
                                            </>
                                        ) : (
                                            <span style={{ color: 'var(--warning)' }}>📍 GPS: ปิดใช้งาน (ไม่ตรวจตำแหน่ง)</span>
                                        )}
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={handleUpdateLocation}
                                        disabled={updatingLocation}
                                        style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                                    >
                                        {updatingLocation ? '📍 กำลังหาตำแหน่ง...' : '📍 อัพเดทตำแหน่ง'}
                                    </button>
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
                                <button className="btn btn-primary btn-lg" onClick={() => setShowStartModal(true)}>
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

            {/* Manual Check-in Modal */}
            <ManualCheckInModal
                isOpen={showManualModal}
                onClose={() => setShowManualModal(false)}
                students={students}
                attendance={attendance}
                onCheckIn={handleManualCheckIn}
                onRecordLeave={handleRecordLeave}
            />

            {/* Start Session Modal */}
            <StartSessionModal
                isOpen={showStartModal}
                onClose={() => setShowStartModal(false)}
                onStart={handleStartSession}
                adminRequireGPS={adminConfig?.requireGPS !== false}
                classroom={selectedClassroom}
            />
        </div>
    );
}
