import { useState } from 'react';

export default function AttendanceList({
    attendance = [],
    showEmpty = true,
    showSortControl = false,
    defaultSortBy = 'time' // 'name', 'studentId', 'time'
}) {
    const [sortBy, setSortBy] = useState(defaultSortBy);

    const formatTime = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getInitials = (name) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const getBadgeInfo = (type) => {
        switch (type) {
            case 'manual':
                return { text: '✎ เช็คโดยอาจารย์', color: 'var(--primary)' };
            case 'leave':
                return { text: '📝 ลา', color: 'var(--warning)' };
            case 'scan':
            default:
                return { text: '✓ เข้าเรียน', color: 'var(--success)' };
        }
    };

    // Sort attendance list
    const sortedAttendance = [...attendance].sort((a, b) => {
        switch (sortBy) {
            case 'name':
                return (a.studentName || '').localeCompare(b.studentName || '', 'th');
            case 'studentId':
                return (a.studentId || '').localeCompare(b.studentId || '');
            case 'time':
            default:
                const timeA = a.checkedAt?.toDate?.() || new Date(a.checkedAt || 0);
                const timeB = b.checkedAt?.toDate?.() || new Date(b.checkedAt || 0);
                return timeA - timeB;
        }
    });

    if (attendance.length === 0 && showEmpty) {
        return (
            <div className="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <p>ยังไม่มีผู้เช็คชื่อ</p>
            </div>
        );
    }

    return (
        <div className="attendance-list-wrapper">
            {/* Sort Control */}
            {showSortControl && attendance.length > 0 && (
                <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)' }}>
                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                        {attendance.length} คน
                    </span>
                    <div className="flex gap-sm items-center">
                        <label style={{ fontSize: '0.85rem' }}>เรียงตาม:</label>
                        <select
                            className="form-input form-select"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{ width: 'auto', minWidth: '100px', padding: '0.3rem 0.5rem' }}
                        >
                            <option value="time">เวลา</option>
                            <option value="name">ชื่อ</option>
                            <option value="studentId">รหัสนิสิต</option>
                        </select>
                    </div>
                </div>
            )}

            <div className="attendance-list">
                {sortedAttendance.map((item, index) => {
                    const badge = getBadgeInfo(item.type);
                    return (
                        <div key={item.id || index} className="attendance-item">
                            <div className="attendance-avatar">
                                {getInitials(item.studentName)}
                            </div>
                            <div className="attendance-info">
                                <div className="attendance-name">{item.studentName}</div>
                                <div className="attendance-time">
                                    {item.studentId} • {formatTime(item.checkedAt)}
                                    {item.type === 'leave' && item.leaveReason && (
                                        <span style={{ marginLeft: '0.5rem', opacity: 0.8 }}>
                                            ({item.leaveReason})
                                        </span>
                                    )}
                                </div>
                            </div>
                            <span
                                className={`attendance-badge badge-${item.type || 'scan'}`}
                            >
                                {badge.text}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
