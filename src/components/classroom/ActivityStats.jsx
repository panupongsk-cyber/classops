import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getSessionsForClassroom,
    getSessionAttendance,
    getStudents,
    manualCheckIn,
    recordLeave,
    deleteAttendance,
    updateAttendance,
    deleteSession,
    toggleSessionExitTicket,
} from '../../firebase/firestore';
import RandomNamePicker from '../RandomNamePicker';
import SessionAttendanceModal from '../SessionAttendanceModal';
import ExitTicketResultsModal from '../ExitTicketResultsModal';

export default function ActivityStats({ classroom }) {
    const { user, userRole } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [loadingSessions, setLoadingSessions] = useState(false);
    const [expandedSession, setExpandedSession] = useState(null);
    const [sessionAttendance, setSessionAttendance] = useState({});
    const [showRandomPicker, setShowRandomPicker] = useState(false);
    const [latestAttendance, setLatestAttendance] = useState([]);
    const [showAttendanceModal, setShowAttendanceModal] = useState(false);
    const [selectedSession, setSelectedSession] = useState(null);
    const [classroomStudents, setClassroomStudents] = useState([]);

    // Exit Ticket state
    const [showExitTicketResults, setShowExitTicketResults] = useState(false);
    const [exitTicketSession, setExitTicketSession] = useState(null);

    // Load sessions
    useEffect(() => {
        const loadSessions = async () => {
            if (!classroom?.id) return;
            setLoadingSessions(true);
            try {
                const data = await getSessionsForClassroom(classroom.id);
                setSessions(data);
                if (data.length > 0) {
                    const attendance = await getSessionAttendance(data[0].id);
                    setLatestAttendance(attendance);
                }
            } catch (error) {
                console.error('Failed to load sessions:', error);
            } finally {
                setLoadingSessions(false);
            }
        };
        loadSessions();
    }, [classroom?.id]);

    const handleExpandSession = async (session) => {
        if (expandedSession === session.id) {
            setExpandedSession(null);
            return;
        }
        setExpandedSession(session.id);
        if (!sessionAttendance[session.id]) {
            try {
                const attendance = await getSessionAttendance(session.id);
                setSessionAttendance(prev => ({ ...prev, [session.id]: attendance }));
            } catch (error) {
                console.error('Failed to load attendance:', error);
            }
        }
    };

    const handleOpenAttendanceModal = async (session) => {
        setSelectedSession(session);
        try {
            const students = await getStudents(classroom.id);
            setClassroomStudents(students);
        } catch (error) {
            console.error('Failed to load students:', error);
        }
        setShowAttendanceModal(true);
    };

    const refreshSessionAttendance = async () => {
        if (!selectedSession) return;
        const attendance = await getSessionAttendance(selectedSession.id);
        setSessionAttendance(prev => ({ ...prev, [selectedSession.id]: attendance }));
    };

    const handleDeleteSession = async (sessionId) => {
        if (userRole !== 'admin' && (sessionAttendance[sessionId]?.length > 0)) {
            alert('ไม่สามารถลบ Session ที่มีการเช็คชื่อแล้วได้');
            return;
        }
        if (!confirm('ยืนยันการลบ Session?')) return;
        try {
            await deleteSession(sessionId);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch (error) {
            alert('ลบไม่สำเร็จ: ' + error.message);
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleDateString('th-TH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div>
            {/* Header */}
            <div className="flex justify-between items-center mb-lg">
                <div>
                    <h3 className="mb-xs">ประวัติกิจกรรม</h3>
                    <p className="text-muted">ประวัติการเช็คชื่อและสุ่มเรียกชื่อ</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowRandomPicker(true)} disabled={latestAttendance.length === 0}>
                    🎲 สุ่มเรียกชื่อ (จากคาบล่าสุด)
                </button>
            </div>

            {/* Stats Overview */}
            <div className="stats-grid mb-lg">
                <div className="stat-card">
                    <div className="stat-value">{sessions.length}</div>
                    <div className="stat-label">ครั้งที่เช็คชื่อ</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{sessions.reduce((sum, s) => sum + (s.attendanceCount || 0), 0)}</div>
                    <div className="stat-label">รวมการเข้าเรียน</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{latestAttendance.length}</div>
                    <div className="stat-label">เข้าเรียนล่าสุด</div>
                </div>
            </div>

            <div className="card">
                <div className="card-header"><h3 className="card-title">ประวัติการเช็คชื่อ</h3></div>
                {loadingSessions ? <div className="text-center py-xl"><div className="spinner"></div></div> : (
                    <div className="session-list">
                        {sessions.map((session, index) => (
                            <div key={session.id} className="session-item">
                                <div className="session-header" onClick={() => handleExpandSession(session)} style={{ cursor: 'pointer' }}>
                                    <div className="flex items-center gap-md">
                                        <div className="session-number">#{sessions.length - index}</div>
                                        <div>
                                            <div className="session-date">{formatDate(session.createdAt)}</div>
                                            <div className="session-meta">
                                                {session.isActive ? <span className="text-success">● กำลังเช็คชื่อ</span> : <span>เสร็จสิ้น</span>}
                                                {session.requireGPS && ' • 📍 GPS'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-md">
                                        <div className="attendance-count">
                                            <span className="count-number">{session.attendanceCount || 0}</span>
                                            <span className="count-label">คน</span>
                                        </div>
                                        <span>{expandedSession === session.id ? '▲' : '▼'}</span>
                                    </div>
                                </div>

                                {expandedSession === session.id && (
                                    <div className="session-details mt-md">
                                        <div className="flex gap-sm mb-md flex-wrap">
                                            <button className="btn btn-primary btn-sm" onClick={() => handleOpenAttendanceModal(session)}>✎ จัดการ</button>
                                            <button className="btn btn-secondary btn-sm" onClick={() => {
                                                const sessionData = session;
                                                setExitTicketSession(sessionData);
                                                setShowExitTicketResults(true);
                                            }}>👁️ Exit Tickets</button>
                                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteSession(session.id)}>🗑️ ลบ</button>
                                        </div>
                                        {sessionAttendance[session.id] ? (
                                            <div className="attendance-grid">
                                                {sessionAttendance[session.id].map((item, idx) => (
                                                    <div key={item.id} className="attendance-item">
                                                        <div className="attendance-info">
                                                            <div className="attendance-name">{item.studentName}</div>
                                                            <div className="attendance-id text-xs text-muted">{item.studentId}</div>
                                                        </div>
                                                        <div className="text-xs">{formatTime(item.checkedAt)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : <p className="text-muted text-center">กำลังโหลด...</p>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <RandomNamePicker isOpen={showRandomPicker} onClose={() => setShowRandomPicker(false)} attendanceList={latestAttendance} />
            <SessionAttendanceModal isOpen={showAttendanceModal} onClose={() => setShowAttendanceModal(false)} session={selectedSession} classroom={classroom} students={classroomStudents} attendance={selectedSession ? sessionAttendance[selectedSession.id] || [] : []} onAddCheckIn={manualCheckIn} onAddLeave={recordLeave} onDeleteAttendance={deleteAttendance} onUpdateAttendance={updateAttendance} refreshAttendance={refreshSessionAttendance} />
            <ExitTicketResultsModal isOpen={showExitTicketResults} onClose={() => setShowExitTicketResults(false)} session={exitTicketSession} classroomName={classroom?.name} />
        </div>
    );
}
