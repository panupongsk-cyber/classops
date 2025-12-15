import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../context/AuthContext';

export default function History() {
    const { user } = useAuth();
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadHistory = async () => {
            if (!user?.email) return;

            try {
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
            } catch (error) {
                console.error('Failed to load history:', error);
            } finally {
                setLoading(false);
            }
        };
        loadHistory();
    }, [user?.email]);

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

                {/* Attendance List */}
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
                            {attendance.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-md"
                                    style={{
                                        padding: 'var(--space-md)',
                                        background: 'var(--bg-glass)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border-color)'
                                    }}
                                >
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: 'var(--radius-md)',
                                        background: 'rgba(34, 197, 94, 0.2)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--success)',
                                        fontSize: '1.2rem'
                                    }}>
                                        ✓
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 500 }}>
                                            {item.classroomName || 'เข้าเรียน'}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                            {formatDate(item.checkedAt)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
