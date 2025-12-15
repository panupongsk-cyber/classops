export default function AttendanceList({ attendance = [], showEmpty = true }) {
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
        <div className="attendance-list">
            {attendance.map((item, index) => (
                <div key={item.id || index} className="attendance-item">
                    <div className="attendance-avatar">
                        {getInitials(item.studentName)}
                    </div>
                    <div className="attendance-info">
                        <div className="attendance-name">{item.studentName}</div>
                        <div className="attendance-time">
                            {item.studentId} • {formatTime(item.checkedAt)}
                        </div>
                    </div>
                    <span className="attendance-badge">✓ เข้าเรียน</span>
                </div>
            ))}
        </div>
    );
}
