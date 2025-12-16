import { useState, useEffect } from 'react';
import { getAllSessions, getSessionAttendance, deleteAttendance, deleteSession, getAllClassrooms } from '../../firebase/firestore';

export default function AttendanceHistory() {
    const [sessions, setSessions] = useState([]);
    const [allSessions, setAllSessions] = useState([]); // Keep original for filtering
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedSession, setSelectedSession] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [loadingAttendance, setLoadingAttendance] = useState(false);

    // Filters
    const [filterClassroom, setFilterClassroom] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [filterStudent, setFilterStudent] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [sessionsData, classroomsData] = await Promise.all([
                getAllSessions(100),
                getAllClassrooms()
            ]);
            setAllSessions(sessionsData);
            setSessions(sessionsData);
            setClassrooms(classroomsData);
        } catch (error) {
            console.error('Failed to load data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Apply filters whenever filter values change
    useEffect(() => {
        let filtered = [...allSessions];

        // Filter by classroom
        if (filterClassroom) {
            filtered = filtered.filter(s => s.classroomId === filterClassroom);
        }

        // Filter by date range
        if (filterDateFrom) {
            const fromDate = new Date(filterDateFrom);
            fromDate.setHours(0, 0, 0, 0);
            filtered = filtered.filter(s => {
                const sessionDate = s.createdAt?.toDate?.() || new Date(s.createdAt);
                return sessionDate >= fromDate;
            });
        }

        if (filterDateTo) {
            const toDate = new Date(filterDateTo);
            toDate.setHours(23, 59, 59, 999);
            filtered = filtered.filter(s => {
                const sessionDate = s.createdAt?.toDate?.() || new Date(s.createdAt);
                return sessionDate <= toDate;
            });
        }

        setSessions(filtered);
        setSelectedSession(null);
        setAttendance([]);
    }, [filterClassroom, filterDateFrom, filterDateTo, allSessions]);

    const handleSelectSession = async (session) => {
        setSelectedSession(session);
        setLoadingAttendance(true);
        try {
            let data = await getSessionAttendance(session.id);

            // Filter by student if set
            if (filterStudent.trim()) {
                const search = filterStudent.toLowerCase().trim();
                data = data.filter(a =>
                    a.studentName?.toLowerCase().includes(search) ||
                    a.studentId?.toLowerCase().includes(search) ||
                    a.studentEmail?.toLowerCase().includes(search)
                );
            }

            setAttendance(data);
        } catch (error) {
            console.error('Failed to load attendance:', error);
            setAttendance([]);
        } finally {
            setLoadingAttendance(false);
        }
    };

    // Re-filter attendance when student filter changes
    useEffect(() => {
        if (selectedSession) {
            handleSelectSession(selectedSession);
        }
    }, [filterStudent]);

    const handleDeleteAttendance = async (attendanceId) => {
        if (!confirm('ต้องการลบการเช็คชื่อนี้?')) return;

        try {
            await deleteAttendance(attendanceId);
            setAttendance(attendance.filter(a => a.id !== attendanceId));
            // Update counts
            setAllSessions(allSessions.map(s =>
                s.id === selectedSession.id
                    ? { ...s, attendanceCount: s.attendanceCount - 1 }
                    : s
            ));
        } catch (error) {
            console.error('Failed to delete:', error);
            alert('ลบไม่สำเร็จ: ' + error.message);
        }
    };

    const handleDeleteSession = async (sessionId) => {
        if (!confirm('⚠️ ต้องการลบเซสชั่นนี้?\n\nการลบเซสชั่นจะลบข้อมูลการเช็คชื่อทั้งหมดที่อยู่ในเซสชั่นนี้ด้วย และไม่สามารถกู้คืนได้')) return;

        try {
            await deleteSession(sessionId);
            // Remove from local state
            setAllSessions(allSessions.filter(s => s.id !== sessionId));
            setSelectedSession(null);
            setAttendance([]);
        } catch (error) {
            console.error('Failed to delete session:', error);
            alert('ลบเซสชั่นไม่สำเร็จ: ' + error.message);
        }
    };

    const handleClearFilters = () => {
        setFilterClassroom('');
        setFilterDateFrom('');
        setFilterDateTo('');
        setFilterStudent('');
    };

    const exportToCSV = () => {
        if (attendance.length === 0) {
            alert('ไม่มีข้อมูลให้ export');
            return;
        }

        // Create CSV content
        const headers = ['ชื่อนักศึกษา', 'รหัสนักศึกษา', 'Email', 'เวลาเช็คชื่อ', 'ระยะห่าง (m)', 'IP Address', 'User Agent'];
        const rows = attendance.map(item => {
            const checkedAt = item.checkedAt?.toDate?.() || new Date(item.checkedAt);
            return [
                item.studentName || '',
                item.studentId || '',
                item.studentEmail || '',
                checkedAt.toLocaleString('th-TH'),
                item.distanceFromTeacher || '',
                item.ipAddress || '',
                `"${(item.userAgent || '').replace(/"/g, '""')}"` // Escape quotes
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Create and download file
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Filename with session info
        const sessionDate = selectedSession?.createdAt?.toDate?.() || new Date();
        const dateStr = sessionDate.toISOString().split('T')[0];
        const classroomName = selectedSession?.classroomName || 'attendance';
        link.download = `${classroomName}_${dateStr}.csv`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
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

    // Calculate summary stats
    const totalAttendance = sessions.reduce((sum, s) => sum + (s.attendanceCount || 0), 0);
    const hasFilters = filterClassroom || filterDateFrom || filterDateTo || filterStudent;

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
            <div className="mb-lg">
                <h1 style={{ marginBottom: '0.25rem' }}>📋 ประวัติการเช็คชื่อ</h1>
                <p className="text-muted">ดูและจัดการรายการเช็คชื่อทั้งหมด</p>
            </div>

            {/* Summary Stats */}
            <div className="stats-grid" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="stat-card">
                    <div className="stat-value">{sessions.length}</div>
                    <div className="stat-label">เซสชั่น</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{totalAttendance}</div>
                    <div className="stat-label">การเช็คชื่อทั้งหมด</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{classrooms.length}</div>
                    <div className="stat-label">รายวิชา</div>
                </div>
            </div>

            {/* Filters */}
            <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="card-header">
                    <h3 className="card-title">🔍 ตัวกรอง</h3>
                    {hasFilters && (
                        <button
                            onClick={handleClearFilters}
                            className="btn"
                            style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }}
                        >
                            ล้างตัวกรอง
                        </button>
                    )}
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 'var(--space-md)'
                }}>
                    <div>
                        <label className="form-label">รายวิชา</label>
                        <select
                            className="form-input form-select"
                            value={filterClassroom}
                            onChange={(e) => setFilterClassroom(e.target.value)}
                        >
                            <option value="">ทั้งหมด</option>
                            {classrooms.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.name} {c.code ? `(${c.code})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">ตั้งแต่วันที่</label>
                        <input
                            type="date"
                            className="form-input"
                            value={filterDateFrom}
                            onChange={(e) => setFilterDateFrom(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="form-label">ถึงวันที่</label>
                        <input
                            type="date"
                            className="form-input"
                            value={filterDateTo}
                            onChange={(e) => setFilterDateTo(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="form-label">ค้นหานักศึกษา</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="ชื่อ / รหัส / email"
                            value={filterStudent}
                            onChange={(e) => setFilterStudent(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: 'var(--space-xl)', alignItems: 'start' }}>
                {/* Sessions List */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">เซสชั่น ({sessions.length})</h3>
                    </div>
                    <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                        {sessions.length === 0 ? (
                            <div className="empty-state">
                                <p>{hasFilters ? 'ไม่พบเซสชั่นที่ตรงกับเงื่อนไข' : 'ยังไม่มีเซสชั่น'}</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-sm">
                                {sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        onClick={() => handleSelectSession(session)}
                                        style={{
                                            padding: 'var(--space-md)',
                                            background: selectedSession?.id === session.id
                                                ? 'var(--primary)'
                                                : 'var(--bg-glass)',
                                            borderRadius: 'var(--radius-md)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                                            {session.classroomName || 'Unknown'}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                            {formatDate(session.createdAt)}
                                        </div>
                                        <div style={{
                                            marginTop: '0.5rem',
                                            display: 'flex',
                                            gap: '0.5rem',
                                            flexWrap: 'wrap'
                                        }}>
                                            <span style={{
                                                padding: '0.2rem 0.5rem',
                                                background: session.isActive ? 'var(--success)' : 'var(--bg-glass)',
                                                borderRadius: 'var(--radius-sm)',
                                                fontSize: '0.75rem'
                                            }}>
                                                {session.isActive ? '🟢 Active' : '⚪ Ended'}
                                            </span>
                                            <span style={{
                                                padding: '0.2rem 0.5rem',
                                                background: 'var(--bg-glass)',
                                                borderRadius: 'var(--radius-sm)',
                                                fontSize: '0.75rem'
                                            }}>
                                                👤 {session.attendanceCount}
                                            </span>
                                            {session.location && (
                                                <span style={{
                                                    padding: '0.2rem 0.5rem',
                                                    background: 'var(--bg-glass)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    fontSize: '0.75rem'
                                                }}>
                                                    📍 GPS
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Attendance Details */}
                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 className="card-title">
                            รายละเอียดการเช็คชื่อ
                            {selectedSession && ` (${attendance.length})`}
                        </h3>
                        {selectedSession && attendance.length > 0 && (
                            <button
                                onClick={exportToCSV}
                                className="btn btn-primary"
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}
                            >
                                📤 Export CSV
                            </button>
                        )}
                    </div>

                    {!selectedSession ? (
                        <div className="empty-state">
                            <p>เลือกเซสชั่นเพื่อดูรายละเอียด</p>
                        </div>
                    ) : loadingAttendance ? (
                        <div className="text-center" style={{ padding: '2rem' }}>
                            <p>กำลังโหลด...</p>
                        </div>
                    ) : attendance.length === 0 ? (
                        <div className="empty-state">
                            <p>{filterStudent ? 'ไม่พบนักศึกษาที่ค้นหา' : 'ไม่มีการเช็คชื่อในเซสชั่นนี้'}</p>
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>นักศึกษา</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>เวลา</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>ระยะห่าง</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>IP</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>User Agent</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>จัดการ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {attendance.map((item) => (
                                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ fontWeight: 500 }}>{item.studentName}</div>
                                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                    {item.studentId} • {item.studentEmail}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {formatTime(item.checkedAt)}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {item.distanceFromTeacher
                                                    ? `${item.distanceFromTeacher}m`
                                                    : '-'
                                                }
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <span style={{
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.8rem',
                                                    background: 'var(--bg-glass)',
                                                    padding: '0.2rem 0.4rem',
                                                    borderRadius: 'var(--radius-sm)'
                                                }}>
                                                    {item.ipAddress || '-'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.75rem', maxWidth: '200px' }}>
                                                <div style={{
                                                    fontSize: '0.75rem',
                                                    color: 'var(--text-muted)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }} title={item.userAgent || '-'}>
                                                    {item.userAgent || '-'}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handleDeleteAttendance(item.id)}
                                                    className="btn btn-danger"
                                                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                                >
                                                    ลบ
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Session Details */}
                    {selectedSession && (
                        <div style={{
                            marginTop: 'var(--space-lg)',
                            padding: 'var(--space-md)',
                            background: 'var(--bg-glass)',
                            borderRadius: 'var(--radius-md)'
                        }}>
                            <h4 style={{ marginBottom: '0.5rem' }}>ข้อมูลเซสชั่น</h4>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                <p><strong>ID:</strong> {selectedSession.id}</p>
                                <p><strong>วิชา:</strong> {selectedSession.classroomName}</p>
                                <p><strong>สร้างเมื่อ:</strong> {formatDate(selectedSession.createdAt)}</p>
                                {selectedSession.location && (
                                    <>
                                        <p><strong>GPS:</strong> {selectedSession.location.latitude.toFixed(6)}, {selectedSession.location.longitude.toFixed(6)}</p>
                                        <p><strong>รัศมี:</strong> {selectedSession.checkInRadius}m</p>
                                    </>
                                )}
                            </div>
                            <button
                                onClick={() => handleDeleteSession(selectedSession.id)}
                                className="btn btn-danger"
                                style={{ marginTop: 'var(--space-md)' }}
                            >
                                🗑️ ลบเซสชั่นนี้
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
