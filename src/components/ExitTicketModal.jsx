import { useState } from 'react';
import Modal from './Modal';

export default function ExitTicketModal({
    isOpen,
    onClose,
    onSubmit,
    sessionId,
    classroomId,
    studentData
}) {
    const [rating, setRating] = useState(7);
    const [reason, setReason] = useState('');
    const [keyTakeaway, setKeyTakeaway] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (rating < 1 || rating > 10) {
            alert('กรุณาให้คะแนน 1-10');
            return;
        }

        setSubmitting(true);
        try {
            await onSubmit(sessionId, classroomId, studentData, rating, reason, keyTakeaway);
            onClose();
        } catch (error) {
            alert('ส่งไม่สำเร็จ: ' + error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleSkip = () => {
        onClose();
    };

    const getRatingEmoji = (r) => {
        if (r <= 3) return '😔';
        if (r <= 5) return '😐';
        if (r <= 7) return '🙂';
        if (r <= 9) return '😊';
        return '🤩';
    };

    const getRatingColor = (r) => {
        if (r <= 3) return '#ef4444';
        if (r <= 5) return '#f59e0b';
        if (r <= 7) return '#eab308';
        if (r <= 9) return '#22c55e';
        return '#10b981';
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleSkip}
            title="📝 Exit Ticket"
        >
            <div style={{ padding: 'var(--space-lg)' }}>
                <p className="text-muted" style={{ marginBottom: 'var(--space-lg)', textAlign: 'center' }}>
                    ให้ความเห็นเกี่ยวกับการเรียนวันนี้
                </p>

                {/* Rating */}
                <div className="form-group">
                    <label className="form-label" style={{ textAlign: 'center', display: 'block' }}>
                        ให้คะแนนการเรียนวันนี้
                    </label>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-md)',
                        marginBottom: 'var(--space-sm)'
                    }}>
                        <span style={{ fontSize: '3rem' }}>{getRatingEmoji(rating)}</span>
                        <span style={{
                            fontSize: '3rem',
                            fontWeight: 700,
                            color: getRatingColor(rating)
                        }}>
                            {rating}
                        </span>
                        <span className="text-muted" style={{ fontSize: '1.5rem' }}>/10</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="10"
                        value={rating}
                        onChange={(e) => setRating(Number(e.target.value))}
                        style={{
                            width: '100%',
                            height: '8px',
                            borderRadius: '4px',
                            background: `linear-gradient(to right, ${getRatingColor(rating)} ${rating * 10}%, var(--bg-secondary) ${rating * 10}%)`,
                            cursor: 'pointer'
                        }}
                    />
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        marginTop: 'var(--space-xs)'
                    }}>
                        <span>ไม่ดี</span>
                        <span>ดีมาก</span>
                    </div>
                </div>

                {/* Reason */}
                <div className="form-group">
                    <label className="form-label">เหตุผลที่ให้คะแนน (ถ้ามี)</label>
                    <textarea
                        className="form-input"
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="บอกเหตุผลสั้นๆ..."
                        style={{ resize: 'none' }}
                    />
                </div>

                {/* Key Takeaway */}
                <div className="form-group">
                    <label className="form-label">สิ่งที่ได้เรียนรู้วันนี้ (Key Takeaway)</label>
                    <textarea
                        className="form-input"
                        rows={3}
                        value={keyTakeaway}
                        onChange={(e) => setKeyTakeaway(e.target.value)}
                        placeholder="วันนี้ได้เรียนรู้อะไรบ้าง..."
                        style={{ resize: 'none' }}
                    />
                </div>

                {/* Buttons */}
                <div style={{
                    display: 'flex',
                    gap: 'var(--space-md)',
                    justifyContent: 'center',
                    marginTop: 'var(--space-lg)'
                }}>
                    <button
                        className="btn btn-secondary"
                        onClick={handleSkip}
                        disabled={submitting}
                    >
                        ข้าม
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={submitting}
                    >
                        {submitting ? 'กำลังส่ง...' : '✅ ส่ง Exit Ticket'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
