import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../context/AuthContext';
import { getExitTicketByStudent, submitExitTicket, isExitTicketOpen, getStudentClassrooms } from '../../firebase/firestore';
import ExitTicketModal from '../../components/ExitTicketModal';
import Feed from '../../components/feed/Feed';

export default function History() {
    const { user } = useAuth();
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('feed'); // 'feed' or 'attendance'
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);

    // Exit ticket state
    const [exitTicketModalOpen, setExitTicketModalOpen] = useState(false);
    const [selectedAttendance, setSelectedAttendance] = useState(null);
    const [exitTicketStatus, setExitTicketStatus] = useState({}); // { sessionId: { submitted: bool, open: bool } }

    useEffect(() => {
        const loadHistory = async () => {
            if (!user?.email) return;

            try {
                // Load classrooms the student is enrolled in
                const studentClassrooms = await getStudentClassrooms(user.email);
                setClassrooms(studentClassrooms);
                if (studentClassrooms.length > 0) {
                    setSelectedClassroom(studentClassrooms[0]);
                }

                console.log('📚 Loading attendance history for:', user.email);
                const q = query(
                    collection(db, 'attendance'),
                    where('studentEmail', '==', user.email.toLowerCase())
                );
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Sort by date in JavaScript (descending)
                data.sort((a, b) => {
                    const dateA = a.checkedAt?.toDate?.() || new Date(a.checkedAt) || new Date(0);
                    const dateB = b.checkedAt?.toDate?.() || new Date(b.checkedAt) || new Date(0);
                    return dateB - dateA;
                });
                console.log('📚 Attendance history loaded:', data.length);
                setAttendance(data);

                // Load exit ticket status for each session
                const statusMap = {};
                for (const item of data) {
                    if (!item.sessionId) continue;

                    // Check if already submitted
                    const existingTicket = await getExitTicketByStudent(item.sessionId, user.email);

                    // Get session data to check if still open
                    let sessionOpen = false;
                    try {
                        const sessionDoc = await getDoc(doc(db, 'sessions', item.sessionId));
                        if (sessionDoc.exists()) {
                            const sessionData = sessionDoc.data();
                            sessionOpen = isExitTicketOpen(sessionData);
                        }
                    } catch (e) {
                        console.log('Could not check session:', e);
                    }

                    statusMap[item.sessionId] = {
                        submitted: !!existingTicket,
                        open: sessionOpen
                    };
                }
                setExitTicketStatus(statusMap);
            } catch (error) {
                console.error('Failed to load history:', error);
            } finally {
                setLoading(false);
            }
        };
        loadHistory();
    }, [user?.email]);

    const handleOpenExitTicket = (item) => {
        setSelectedAttendance(item);
        setExitTicketModalOpen(true);
    };

    const handleSubmitExitTicket = async (sessionId, classroomId, studentData, rating, reason, keyTakeaway) => {
        await submitExitTicket(sessionId, classroomId, studentData, rating, reason, keyTakeaway);
        // Update status
        setExitTicketStatus(prev => ({
            ...prev,
            [sessionId]: { ...prev[sessionId], submitted: true }
        }));
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleDateString('th-TH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
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

    const getExitTicketBadge = (sessionId) => {
        const status = exitTicketStatus[sessionId];
        if (!status) return null;

        if (status.submitted) {
            return (
                <span style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(34, 197, 94, 0.2)',
                    color: 'var(--success)'
                }}>
                    ✓ ส่งแล้ว
                </span>
            );
        }

        if (status.open) {
            return (
                <span style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(249, 115, 22, 0.2)',
                    color: 'var(--primary)',
                    cursor: 'pointer'
                }}>
                    📝 รอส่ง
                </span>
            );
        }

        return null;
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

    return (
        <div className="page container">
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                <h1>ประวัติการเข้าเรียน</h1>
                <p className="text-muted mb-lg">บันทึกการเช็คชื่อของคุณ</p>

                {/* Stats */}
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 'var(--space-lg)' }}>
                    <div className="stat-card">
                        <div className="stat-value">{attendance.length}</div>
                        <div className="stat-label">ครั้งที่เช็คชื่อ</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">
                            {attendance.length > 0 ? formatShortDate(attendance[0].checkedAt) : '-'}
                        </div>
                        <div className="stat-label">ล่าสุด</div>
                    </div>
                </div>

                {/* View Toggle Tabs */}
                <div className="flex gap-md mb-lg border-b pb-sm">
                    <button
                        className={`btn-tab ${activeTab === 'feed' ? 'active' : ''}`}
                        onClick={() => setActiveTab('feed')}
                        style={{ 
                            padding: '0.5rem 1rem', 
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
                            padding: '0.5rem 1rem', 
                            border: 'none', 
                            background: 'none', 
                            borderBottom: activeTab === 'attendance' ? '3px solid var(--primary-color)' : '3px solid transparent',
                            fontWeight: activeTab === 'attendance' ? 'bold' : 'normal',
                            cursor: 'pointer'
                        }}
                    >
                        📊 ประวัติการเข้าเรียน
                    </button>
                </div>

                {activeTab === 'feed' ? (
                    <div className="feed-view">
                        {classrooms.length > 0 ? (
                            <>
                                <div className="mb-md">
                                    <label className="text-sm text-muted mb-xs block">เลือกชั้นเรียน:</label>
                                    <select 
                                        className="form-input" 
                                        value={selectedClassroom?.id || ''}
                                        onChange={(e) => setSelectedClassroom(classrooms.find(c => c.id === e.target.value))}
                                    >
                                        {classrooms.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <Feed classroomId={selectedClassroom?.id} />
                            </>
                        ) : (
                            <div className="card text-center py-xl">
                                <p className="text-muted">คุณยังไม่ได้ลงทะเบียนในชั้นเรียนใดๆ</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="card">
                        <div className="card-header">
                            <h3 className="card-title">รายการเช็คชื่อ</h3>
                        </div>

                        {attendance.length === 0 ? (
                            <div className="empty-state">
                                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                </svg>
                                <p>ยังไม่มีประวัติการเช็คชื่อ</p>
                                <p className="text-muted" style={{ fontSize: '0.9rem' }}>
                                    Scan QR Code ที่อาจารย์แสดงเพื่อเช็คชื่อ
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-sm">
                                {attendance.map((item) => {
                                const status = exitTicketStatus[item.sessionId];
                                const canSubmit = status?.open && !status?.submitted;

                                return (
                                    <div
                                        key={item.id}
                                        style={{
                                            padding: 'var(--space-md)',
                                            background: 'var(--bg-glass)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--border-color)'
                                        }}
                                    >
                                        <div className="flex items-center gap-md">
                                            <div style={{
                                                width: '40px',
                                                height: '40px',
                                                borderRadius: 'var(--radius-md)',
                                                background: 'rgba(34, 197, 94, 0.2)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'var(--success)',
                                                fontSize: '1.2rem',
                                                flexShrink: 0
                                            }}>
                                                ✓
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                                    {item.classroomName || 'เข้าเรียน'}
                                                    {getExitTicketBadge(item.sessionId)}
                                                </div>
                                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                                    {formatDate(item.checkedAt)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Exit Ticket Button */}
                                        {canSubmit && (
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => handleOpenExitTicket(item)}
                                                style={{
                                                    width: '100%',
                                                    marginTop: 'var(--space-sm)',
                                                    padding: 'var(--space-sm) var(--space-md)'
                                                }}
                                            >
                                                📝 ส่ง Exit Ticket
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                )}
            </div>

            {/* Exit Ticket Modal */}
            <ExitTicketModal
                isOpen={exitTicketModalOpen}
                onClose={() => {
                    setExitTicketModalOpen(false);
                    setSelectedAttendance(null);
                }}
                onSubmit={handleSubmitExitTicket}
                sessionId={selectedAttendance?.sessionId}
                classroomId={selectedAttendance?.classroomId}
                studentData={{
                    studentId: selectedAttendance?.studentId || '',
                    email: user?.email || '',
                    name: selectedAttendance?.studentName || user?.displayName || ''
                }}
            />
        </div>
    );
}
