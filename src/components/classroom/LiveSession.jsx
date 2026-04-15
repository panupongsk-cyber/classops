import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getActiveSession,
    createSession,
    endSession,
    subscribeToAttendance,
    getStudents,
    getAdminConfig,
    manualCheckIn,
    recordLeave,
    updateSessionLocation,
    DEFAULT_CHECKIN_RADIUS,
    DEFAULT_QR_INTERVAL,
    DEFAULT_GRACE_PERIOD,
} from '../../firebase/firestore';
import QRGenerator from '../QRGenerator';
import AttendanceList from '../AttendanceList';
import ManualCheckInModal from '../ManualCheckInModal';
import StartSessionModal from '../StartSessionModal';

export default function LiveSession({ classroom }) {
    const { user } = useAuth();
    const [session, setSession] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [studentCount, setStudentCount] = useState(0);
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showManualModal, setShowManualModal] = useState(false);
    const [showStartModal, setShowStartModal] = useState(false);
    const [adminConfig, setAdminConfig] = useState(null);
    const [updatingLocation, setUpdatingLocation] = useState(false);

    // Load active session and student count
    useEffect(() => {
        const loadSessionData = async () => {
            if (!classroom?.id) return;

            try {
                const activeSession = await getActiveSession(classroom.id);
                setSession(activeSession);

                const studentsData = await getStudents(classroom.id);
                setStudents(studentsData);
                setStudentCount(studentsData.length);
                
                const config = await getAdminConfig();
                setAdminConfig(config);
            } catch (error) {
                console.error('Failed to load session:', error);
            } finally {
                setLoading(false);
            }
        };
        loadSessionData();
    }, [classroom?.id]);

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

    const handleStartSession = async ({ useGPS, location }) => {
        try {
            const checkInRadius = adminConfig?.checkInRadius || DEFAULT_CHECKIN_RADIUS;
            const qrInterval = classroom.qrInterval || adminConfig?.qrInterval || DEFAULT_QR_INTERVAL;
            const gracePeriod = adminConfig?.gracePeriod || DEFAULT_GRACE_PERIOD;

            const newSession = await createSession(
                classroom.id,
                qrInterval,
                useGPS ? location : null,
                checkInRadius,
                gracePeriod,
                useGPS
            );

            setSession({
                id: newSession.id,
                classroomId: classroom.id,
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
                    enableHighAccuracy: true, timeout: 15000, maximumAge: 0
                });
            });
            const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
            const checkInRadius = adminConfig?.checkInRadius || DEFAULT_CHECKIN_RADIUS;
            await updateSessionLocation(session.id, location, checkInRadius);
            setSession(prev => ({ ...prev, location, requireGPS: true }));
            alert(`✅ อัพเดทตำแหน่งสำเร็จ!`);
        } catch (error) {
            alert('ไม่สามารถอัพเดทตำแหน่งได้: ' + error.message);
        } finally {
            setUpdatingLocation(false);
        }
    };

    const handleEndSession = async () => {
        if (!session?.id) return;
        if (!window.confirm('ยืนยันการปิดการเช็คชื่อ?')) return;
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
        await manualCheckIn(session.id, student, classroom?.name || '', user?.email || '');
    };

    const handleRecordLeave = async (student, reason) => {
        if (!session?.id) return;
        await recordLeave(session.id, student, classroom?.name || '', reason, user?.email || '');
    };

    if (loading) return <div className="text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 'var(--space-xl)', alignItems: 'start' }}>
            <div>
                {/* Stats */}
                <div className="stats-grid mb-lg">
                    <div className="stat-card">
                        <div className="stat-value">{attendance.length}</div>
                        <div className="stat-label">เช็คชื่อแล้ว</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{studentCount}</div>
                        <div className="stat-label">ทั้งหมด</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{studentCount > 0 ? Math.round((attendance.length / studentCount) * 100) : 0}%</div>
                        <div className="stat-label">เข้าเรียน</div>
                    </div>
                </div>

                <div className="card">
                    {session?.isActive ? (
                        <>
                            <div className="card-header">
                                <h3 className="card-title">กำลังเปิดเช็คชื่อ</h3>
                                <div className="flex gap-sm">
                                    <button className="btn btn-secondary" onClick={() => setShowManualModal(true)}>➕ เช็คชื่อ/ลา</button>
                                    <button className="btn btn-danger" onClick={handleEndSession}>ปิดเซสชั่น</button>
                                </div>
                            </div>
                            <div className="flex justify-center">
                                <QRGenerator session={session} qrInterval={classroom?.qrInterval || 30} />
                            </div>
                            <div className="mt-md p-md bg-secondary rounded flex justify-between items-center" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                <div>
                                    {session.requireGPS ? <span className="text-success">📍 GPS: On</span> : <span className="text-warning">📍 GPS: Off</span>}
                                </div>
                                <button className="btn btn-secondary btn-sm" onClick={handleUpdateLocation} disabled={updatingLocation}>
                                    {updatingLocation ? '...' : '📍 อัพเดทตำแหน่ง'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-xl">
                            <h3 className="mb-md">พร้อมเปิดเช็คชื่อ</h3>
                            <button className="btn btn-primary btn-lg" onClick={() => setShowStartModal(true)}>เริ่มเช็คชื่อ</button>
                        </div>
                    )}
                </div>
            </div>

            <div className="card" style={{ position: 'sticky', top: '100px' }}>
                <div className="card-header"><h3 className="card-title">ผู้เข้าเรียน</h3></div>
                <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    <AttendanceList attendance={attendance} />
                </div>
            </div>

            <ManualCheckInModal isOpen={showManualModal} onClose={() => setShowManualModal(false)} students={students} attendance={attendance} onCheckIn={handleManualCheckIn} onRecordLeave={handleRecordLeave} />
            <StartSessionModal isOpen={showStartModal} onClose={() => setShowStartModal(false)} onStart={handleStartSession} adminRequireGPS={adminConfig?.requireGPS !== false} classroom={classroom} />
        </div>
    );
}
