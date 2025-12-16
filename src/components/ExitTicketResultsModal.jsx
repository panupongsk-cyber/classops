import { useState, useEffect } from 'react';
import Modal from './Modal';
import { getSessionExitTickets } from '../firebase/firestore';

export default function ExitTicketResultsModal({ isOpen, onClose, session, classroomName }) {
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadTickets = async () => {
            if (!session?.id || !isOpen) return;
            setLoading(true);
            try {
                const data = await getSessionExitTickets(session.id);
                setTickets(data);
            } catch (error) {
                console.error('Failed to load exit tickets:', error);
            } finally {
                setLoading(false);
            }
        };
        loadTickets();
    }, [session?.id, isOpen]);

    // Calculate stats
    const avgRating = tickets.length > 0
        ? (tickets.reduce((sum, t) => sum + (t.rating || 0), 0) / tickets.length).toFixed(1)
        : 0;

    // Rating distribution
    const distribution = {};
    for (let i = 1; i <= 10; i++) distribution[i] = 0;
    tickets.forEach(t => {
        if (t.rating >= 1 && t.rating <= 10) {
            distribution[t.rating]++;
        }
    });
    const maxCount = Math.max(...Object.values(distribution), 1);

    const exportToCSV = () => {
        if (tickets.length === 0) {
            alert('ไม่มีข้อมูล');
            return;
        }

        const headers = ['รหัสนิสิต', 'ชื่อ', 'คะแนน', 'เหตุผล', 'Key Takeaway'];
        const rows = tickets.map(t => [
            t.studentId || '',
            t.studentName || '',
            t.rating || '',
            `"${(t.reason || '').replace(/"/g, '""')}"`,
            `"${(t.keyTakeaway || '').replace(/"/g, '""')}"`
        ].join(','));

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `exit_tickets_${classroomName || 'session'}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="📝 Exit Ticket Results"
        >
            <div style={{ padding: 'var(--space-lg)', maxHeight: '70vh', overflowY: 'auto' }}>
                {loading ? (
                    <p className="text-center text-muted">กำลังโหลด...</p>
                ) : tickets.length === 0 ? (
                    <div className="text-center" style={{ padding: 'var(--space-xl)' }}>
                        <p className="text-muted">ยังไม่มีนิสิตส่ง Exit Ticket</p>
                    </div>
                ) : (
                    <>
                        {/* Stats Summary */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: 'var(--space-md)',
                            marginBottom: 'var(--space-lg)'
                        }}>
                            <div style={{
                                background: 'var(--bg-glass)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-lg)',
                                textAlign: 'center'
                            }}>
                                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary-light)' }}>
                                    {avgRating}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>คะแนนเฉลี่ย</div>
                            </div>
                            <div style={{
                                background: 'var(--bg-glass)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-lg)',
                                textAlign: 'center'
                            }}>
                                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary-light)' }}>
                                    {tickets.length}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>จำนวนตอบ</div>
                            </div>
                        </div>

                        {/* Rating Distribution */}
                        <div style={{ marginBottom: 'var(--space-lg)' }}>
                            <h4 style={{ marginBottom: 'var(--space-sm)' }}>การกระจายคะแนน</h4>
                            <div style={{
                                display: 'flex',
                                alignItems: 'flex-end',
                                gap: '2px',
                                height: '60px'
                            }}>
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                                    <div
                                        key={score}
                                        style={{
                                            flex: 1,
                                            background: score <= 3 ? '#ef4444' : score <= 5 ? '#f59e0b' : score <= 7 ? '#eab308' : '#22c55e',
                                            height: `${(distribution[score] / maxCount) * 100}%`,
                                            minHeight: distribution[score] > 0 ? '4px' : '0',
                                            borderRadius: '2px 2px 0 0',
                                            position: 'relative'
                                        }}
                                        title={`${score}: ${distribution[score]} คน`}
                                    />
                                ))}
                            </div>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                                marginTop: '2px'
                            }}>
                                <span>1</span>
                                <span>5</span>
                                <span>10</span>
                            </div>
                        </div>

                        {/* Export Button */}
                        <div style={{ marginBottom: 'var(--space-lg)' }}>
                            <button className="btn btn-secondary" onClick={exportToCSV}>
                                📤 Export CSV
                            </button>
                        </div>

                        {/* Responses List */}
                        <h4 style={{ marginBottom: 'var(--space-sm)' }}>รายละเอียด</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                            {tickets.map((ticket, idx) => (
                                <div
                                    key={ticket.id || idx}
                                    style={{
                                        background: 'var(--bg-glass)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--space-md)'
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 'var(--space-sm)'
                                    }}>
                                        <span style={{ fontWeight: 500 }}>
                                            {ticket.studentName || 'ไม่ระบุ'}
                                        </span>
                                        <span style={{
                                            fontSize: '1.25rem',
                                            fontWeight: 700,
                                            color: ticket.rating <= 5 ? '#f59e0b' : '#22c55e'
                                        }}>
                                            {ticket.rating}/10
                                        </span>
                                    </div>
                                    {ticket.reason && (
                                        <p style={{ fontSize: '0.9rem', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)' }}>
                                            <strong>เหตุผล:</strong> {ticket.reason}
                                        </p>
                                    )}
                                    {ticket.keyTakeaway && (
                                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <strong>Key Takeaway:</strong> {ticket.keyTakeaway}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
