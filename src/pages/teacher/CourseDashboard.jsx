import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getClassrooms,
    getAllClassrooms,
    getSessionsForClassroom,
    getSessionAttendance,
    getStudents,
    manualCheckIn,
    recordLeave,
    deleteAttendance,
    updateAttendance,
    deleteSession,
    toggleSessionExitTicket,
    getExitTicketStats
} from '../../firebase/firestore';
import RandomNamePicker from '../../components/RandomNamePicker';
import SessionAttendanceModal from '../../components/SessionAttendanceModal';
import ExitTicketResultsModal from '../../components/ExitTicketResultsModal';
import Feed from '../../components/feed/Feed';

export default function CourseDashboard() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [activeTab, setActiveTab] = useState('feed'); // 'feed' or 'attendance'
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
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
    const [exitTicketStats, setExitTicketStats] = useState({}); // { sessionId: { count, avgRating } }

    // Load classrooms
    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid, user.email);

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

    // Load sessions when classroom changes
    useEffect(() => {
        const loadSessions = async () => {
            if (!selectedClassroom?.id) return;

            setLoadingSessions(true);
            try {
                const data = await getSessionsForClassroom(selectedClassroom.id);
                setSessions(data);

                // Load latest session attendance for random picker
                if (data.length > 0) {
                    const latestSession = data[0];
                    const attendance = await getSessionAttendance(latestSession.id);
                    setLatestAttendance(attendance);
                } else {
                    setLatestAttendance([]);
                }
            } catch (error) {
                console.error('Failed to load sessions:', error);
            } finally {
                setLoadingSessions(false);
            }
        };
        loadSessions();
    }, [selectedClassroom?.id]);

    // Load attendance for expanded session
    const handleExpandSession = async (session) => {
        if (expandedSession === session.id) {
            setExpandedSession(null);
            return;
        }

        setExpandedSession(session.id);

        if (!sessionAttendance[session.id]) {
            try {
                const attendance = await getSessionAttendance(session.id);
                setSessionAttendance(prev => ({
                    ...prev,
                    [session.id]: attendance
                }));
            } catch (error) {
                console.error('Failed to load attendance:', error);
            }
        }
    };

    // Open attendance modal for a session
    const handleOpenAttendanceModal = async (session) => {
        setSelectedSession(session);
        // Load students for this classroom
        try {
            const students = await getStudents(selectedClassroom.id);
            setClassroomStudents(students);
        } catch (error) {
            console.error('Failed to load students:', error);
        }
        setShowAttendanceModal(true);
    };

    // Refresh attendance for selected session
    const refreshSessionAttendance = async () => {
        if (!selectedSession) return;
        try {
            const attendance = await getSessionAttendance(selectedSession.id);
            setSessionAttendance(prev => ({
                ...prev,
                [selectedSession.id]: attendance
            }));
        } catch (error) {
            console.error('Failed to refresh attendance:', error);
        }
    };

    // Handlers for attendance CRUD
    const handleAddCheckIn = async (sessionId, student, classroomName) => {
        await manualCheckIn(sessionId, student, classroomName, user.email);
    };

    const handleAddLeave = async (sessionId, student, classroomName, reason) => {
        await recordLeave(sessionId, student, classroomName, reason, user.email);
    };

    const handleDeleteAttendance = async (attendanceId) => {
        await deleteAttendance(attendanceId);
    };

    const handleUpdateAttendance = async (attendanceId, data) => {
        await updateAttendance(attendanceId, data);
    };

    // Delete session and all attendance records
    const handleDeleteSession = async (sessionId) => {
        // Check attendance count for this session
        const attendance = sessionAttendance[sessionId] || [];
        const hasAttendance = attendance.length > 0;

        // Teachers can only delete empty sessions, admin can delete any
        if (hasAttendance && userRole !== 'admin') {
            alert('ไม่สามารถลบ Session ที่มีการเช็คชื่อแล้วได้\nกรุณาติดต่อ Admin เพื่อลบ Session นี้');
            return;
        }

        const confirmMessage = hasAttendance
            ? `⚠️ Session นี้มีการเช็คชื่อ ${attendance.length} คน\nลบ Session และข้อมูลการเช็คชื่อทั้งหมด? การกระทำนี้ไม่สามารถย้อนกลับได้`
            : 'ลบ Session ที่ว่างนี้?';

        if (!confirm(confirmMessage)) return;

        try {
            await deleteSession(sessionId);
            // Refresh sessions list
            const data = await getSessionsForClassroom(selectedClassroom.id);
            setSessions(data);
            // Clear expanded session if deleted
            if (expandedSession === sessionId) {
                setExpandedSession(null);
            }
        } catch (error) {
            console.error('Failed to delete session:', error);
            alert('ลบ Session ไม่สำเร็จ: ' + error.message);
        }
    };

    // Export attendance to CSV
    const exportToCSV = (session) => {
        const attendance = sessionAttendance[session.id] || [];
        if (attendance.length === 0) {
            alert('ไม่มีข้อมูลการเช็คชื่อใน Session นี้');
            return;
        }

        // Build CSV content
        const dateStr = formatDate(session.createdAt).replace(/[,:\s]/g, '_');
        const classroomName = selectedClassroom?.name || 'classroom';

        const rows = attendance.map((item, idx) => {
            const time = item.checkedAt?.toDate?.() || new Date(item.checkedAt);
            return [
                idx + 1,
                item.studentId || '',
                item.studentName || '',
                time.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
                item.type === 'leave' ? 'ลา' : item.type === 'manual' ? 'เช็คโดยอาจารย์' : 'สแกน',
                item.leaveReason || ''
            ].join(',');
        });

        const csvContent = [
            'ลำดับ,รหัสนิสิต,ชื่อ-นามสกุล,เวลา,ประเภท,เหตุผล',
            ...rows
        ].join('\n');

        // Download file
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${classroomName}_${dateStr}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Toggle exit ticket for session
    const handleToggleExitTicket = async (session) => {
        const newValue = !session.exitTicketEnabled;
        try {
            await toggleSessionExitTicket(session.id, newValue);
            // Update local state
            setSessions(prev => prev.map(s =>
                s.id === session.id ? { ...s, exitTicketEnabled: newValue } : s
            ));
        } catch (error) {
            console.error('Failed to toggle exit ticket:', error);
            alert('เปลี่ยนสถานะไม่สำเร็จ: ' + error.message);
        }
    };

    // Load exit ticket stats for a session
    const loadExitTicketStats = async (sessionId) => {
        if (exitTicketStats[sessionId]) return; // Already loaded
        try {
            const stats = await getExitTicketStats(sessionId);
            setExitTicketStats(prev => ({ ...prev, [sessionId]: stats }));
        } catch (error) {
            console.error('Failed to load exit ticket stats:', error);
        }
    };

    // Open exit ticket results modal
    const handleViewExitTickets = (session) => {
        setExitTicketSession(session);
        setShowExitTicketResults(true);
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleDateString('th-TH', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatShortDate = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short'
        });
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit'
        });
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
                    <p className="text-muted mb-lg">สร้างรายวิชาและเช็คชื่อเพื่อดูสถิติ</p>
                    <a href="/teacher/classrooms" className="btn btn-primary">
                        + สร้างรายวิชา
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="page container">
            {/* Header */}
            <div className="flex justify-between items-center mb-lg">
                <div>
                    <h1 style={{ marginBottom: '0.25rem' }}>สถิติรายวิชา</h1>
                    <p className="text-muted">ประวัติการเช็คชื่อและสุ่มเรียกชื่อ</p>
                </div>

                <div className="flex gap-md items-center">
                    {/* Random Picker Button */}
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowRandomPicker(true)}
                        disabled={latestAttendance.length === 0}
                    >
                        🎲 สุ่มเรียกชื่อ
                    </button>

                    {/* Classroom Selector */}
                    <select
                        className="form-input form-select"
                        value={selectedClassroom?.id || ''}
                        onChange={(e) => {
                            const classroom = classrooms.find(c => c.id === e.target.value);
                            setSelectedClassroom(classroom);
                            setSessions([]);
                            setExpandedSession(null);
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
            </div>

            {/* Stats Overview */}
            <div className="stats-grid mb-lg">
                <div className="stat-card">
                    <div className="stat-value">{sessions.length}</div>
                    <div className="stat-label">ครั้งที่เช็คชื่อ</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">
                        {sessions.reduce((sum, s) => sum + (s.attendanceCount || 0), 0)}
                    </div>
                    <div className="stat-label">รวมการเข้าเรียน</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{latestAttendance.length}</div>
                    <div className="stat-label">เข้าเรียนล่าสุด</div>
                </div>
            </div>

            {/* View Toggle Tabs */}
            <div className="flex gap-md mb-lg border-b pb-sm">
                <button
                    className={`btn-tab ${activeTab === 'feed' ? 'active' : ''}`}
                    onClick={() => setActiveTab('feed')}
                    style={{ 
                        padding: '0.5rem 1.5rem', 
                        border: 'none', 
                        background: 'none', 
                        borderBottom: activeTab === 'feed' ? '3px solid var(--primary-color)' : '3px solid transparent',
                        fontWeight: activeTab === 'feed' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                >
                    📰 ฟีดชั้นเรียน
                </button>
                <button
                    className={`btn-tab ${activeTab === 'attendance' ? 'active' : ''}`}
                    onClick={() => setActiveTab('attendance')}
                    style={{ 
                        padding: '0.5rem 1.5rem', 
                        border: 'none', 
                        background: 'none', 
                        borderBottom: activeTab === 'attendance' ? '3px solid var(--primary-color)' : '3px solid transparent',
                        fontWeight: activeTab === 'attendance' ? 'bold' : 'normal',
                        cursor: 'pointer'
                    }}
                >
                    📊 การเข้าเรียน
                </button>
            </div>

            {activeTab === 'feed' ? (
                <Feed classroomId={selectedClassroom?.id} />
            ) : (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">ประวัติการเช็คชื่อ</h3>
                    </div>

                    {loadingSessions ? (
                        <div className="text-center" style={{ padding: '2rem' }}>
                            <p className="text-muted">กำลังโหลด...</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="text-center" style={{ padding: '2rem' }}>
                            <p className="text-muted">ยังไม่มีประวัติการเช็คชื่อ</p>
                        </div>
                    ) : (
                        <div className="session-list">
                            {sessions.map((session, index) => (
                                <div key={session.id} className="session-item">
                                <div
                                    className="session-header"
                                    onClick={() => handleExpandSession(session)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <div className="flex items-center gap-md">
                                        <div className="session-number">
                                            #{sessions.length - index}
                                        </div>
                                        <div>
                                            <div className="session-date">
                                                {formatDate(session.createdAt)}
                                            </div>
                                            <div className="session-meta">
                                                {session.isActive ? (
                                                    <span style={{ color: 'var(--success)' }}>● กำลังเช็คชื่อ</span>
                                                ) : (
                                                    <span>เสร็จสิ้น</span>
                                                )}
                                                {session.requireGPS && ' • 📍 GPS'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-md">
                                        <div className="attendance-count">
                                            <span className="count-number">{session.attendanceCount || 0}</span>
                                            <span className="count-label">คน</span>
                                        </div>
                                        <span style={{
                                            transform: expandedSession === session.id ? 'rotate(180deg)' : 'none',
                                            transition: 'transform 0.2s',
                                            opacity: 0.5
                                        }}>
                                            ▼
                                        </span>
                                    </div>
                                </div>

                                {/* Expanded Attendance List */}
                                {expandedSession === session.id && (
                                    <div className="session-details">
                                        {/* Manage Attendance Button */}
                                        <div style={{ marginBottom: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                            <button
                                                className="btn btn-primary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenAttendanceModal(session);
                                                }}
                                            >
                                                ✎ จัดการการเช็คชื่อ
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    exportToCSV(session);
                                                }}
                                            >
                                                📤 Export CSV
                                            </button>
                                            <button
                                                className="btn btn-danger"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteSession(session.id);
                                                }}
                                            >
                                                🗑️ ลบ Session
                                            </button>
                                        </div>

                                        {/* Exit Ticket Controls */}
                                        <div style={{
                                            marginBottom: 'var(--space-md)',
                                            padding: 'var(--space-md)',
                                            background: 'var(--bg-glass)',
                                            borderRadius: 'var(--radius-md)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            flexWrap: 'wrap',
                                            gap: 'var(--space-sm)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                                <span>📝 Exit Ticket:</span>
                                                {(() => {
                                                    const isClosed = session.exitTicketClosedManually;
                                                    // Handle missing deadline - for old sessions
                                                    let deadline = null;
                                                    if (session.exitTicketDeadline) {
                                                        deadline = session.exitTicketDeadline.toDate?.() || new Date(session.exitTicketDeadline);
                                                        // Check if valid date
                                                        if (isNaN(deadline.getTime())) deadline = null;
                                                    }
                                                    const isExpired = deadline && new Date() > deadline;
                                                    const isOpen = session.exitTicketEnabled && !isClosed && !isExpired;

                                                    if (isOpen) {
                                                        return (
                                                            <>
                                                                <span style={{
                                                                    padding: '2px 8px',
                                                                    borderRadius: 'var(--radius-full)',
                                                                    background: 'rgba(34, 197, 94, 0.2)',
                                                                    color: 'var(--success)',
                                                                    fontSize: '0.85rem'
                                                                }}>
                                                                    เปิดรับ
                                                                </span>
                                                                {deadline && (
                                                                    <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                                        ถึง {deadline.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                                                                    </span>
                                                                )}
                                                            </>
                                                        );
                                                    }
                                                    return (
                                                        <span style={{
                                                            padding: '2px 8px',
                                                            borderRadius: 'var(--radius-full)',
                                                            background: 'rgba(107, 114, 128, 0.2)',
                                                            color: 'var(--text-muted)',
                                                            fontSize: '0.85rem'
                                                        }}>
                                                            {isClosed ? 'ปิดแล้ว' : isExpired ? 'หมดเวลา' : 'ปิด'}
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                                {/* Close button - only show if open */}
                                                {session.exitTicketEnabled && !session.exitTicketClosedManually && (
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleToggleExitTicket(session);
                                                        }}
                                                        style={{ fontSize: '0.85rem', padding: 'var(--space-xs) var(--space-sm)' }}
                                                    >
                                                        ปิดรับ
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewExitTickets(session);
                                                    }}
                                                    style={{ fontSize: '0.85rem', padding: 'var(--space-xs) var(--space-sm)' }}
                                                >
                                                    👁️ ดูผลลัพธ์
                                                </button>
                                            </div>
                                        </div>

                                        {sessionAttendance[session.id] ? (
                                            sessionAttendance[session.id].length === 0 ? (
                                                <p className="text-muted text-center">ไม่มีผู้เข้าเรียน</p>
                                            ) : (
                                                <div className="attendance-grid">
                                                    {sessionAttendance[session.id].map((item, idx) => (
                                                        <div key={item.id} className="attendance-item">
                                                            <span className="attendance-index">{idx + 1}</span>
                                                            <div className="attendance-info">
                                                                <div className="attendance-name">{item.studentName}</div>
                                                                <div className="attendance-id">{item.studentId}</div>
                                                            </div>
                                                            <div className="attendance-time">
                                                                {formatTime(item.checkedAt)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )
                                        ) : (
                                            <p className="text-muted text-center">กำลังโหลด...</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            )}

            {/* Random Picker Modal */}
            <RandomNamePicker
                isOpen={showRandomPicker}
                onClose={() => setShowRandomPicker(false)}
                attendanceList={latestAttendance}
            />

            {/* Session Attendance Modal - for editing after session closes */}
            <SessionAttendanceModal
                isOpen={showAttendanceModal}
                onClose={() => {
                    setShowAttendanceModal(false);
                    setSelectedSession(null);
                }}
                session={selectedSession}
                classroom={selectedClassroom}
                students={classroomStudents}
                attendance={selectedSession ? sessionAttendance[selectedSession.id] || [] : []}
                onAddCheckIn={handleAddCheckIn}
                onAddLeave={handleAddLeave}
                onDeleteAttendance={handleDeleteAttendance}
                onUpdateAttendance={handleUpdateAttendance}
                refreshAttendance={refreshSessionAttendance}
            />

            {/* Exit Ticket Results Modal */}
            <ExitTicketResultsModal
                isOpen={showExitTicketResults}
                onClose={() => {
                    setShowExitTicketResults(false);
                    setExitTicketSession(null);
                }}
                session={exitTicketSession}
                classroomName={selectedClassroom?.name}
            />
        </div>
    );
}
