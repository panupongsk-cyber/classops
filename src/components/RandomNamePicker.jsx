import { useState, useEffect, useRef } from 'react';

export default function RandomNamePicker({ isOpen, onClose, attendanceList = [] }) {
    const [isSpinning, setIsSpinning] = useState(false);
    const [selectedName, setSelectedName] = useState(null);
    const [excludedNames, setExcludedNames] = useState([]);
    const [displayName, setDisplayName] = useState('');
    const spinIntervalRef = useRef(null);
    const slowDownTimeoutRef = useRef(null);

    // Get available names (exclude already picked)
    const availableNames = attendanceList.filter(
        item => !excludedNames.includes(item.studentEmail)
    );

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
            if (slowDownTimeoutRef.current) clearTimeout(slowDownTimeoutRef.current);
        };
    }, []);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedName(null);
            setDisplayName('');
            setIsSpinning(false);
        }
    }, [isOpen]);

    const startSpin = () => {
        if (availableNames.length === 0) return;

        setIsSpinning(true);
        setSelectedName(null);

        let speed = 50; // Start fast
        let spinCount = 0;
        const maxSpins = 30 + Math.floor(Math.random() * 20); // Random number of spins

        // Pick the final winner now
        const winnerIndex = Math.floor(Math.random() * availableNames.length);
        const winner = availableNames[winnerIndex];

        const spin = () => {
            const randomIndex = Math.floor(Math.random() * availableNames.length);
            setDisplayName(availableNames[randomIndex].studentName);
            spinCount++;

            if (spinCount >= maxSpins) {
                // Final selection
                setDisplayName(winner.studentName);
                setSelectedName(winner);
                setExcludedNames(prev => [...prev, winner.studentEmail]);
                setIsSpinning(false);
                if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
                return;
            }

            // Gradually slow down
            if (spinCount > maxSpins - 10) {
                speed += 30;
                clearInterval(spinIntervalRef.current);
                spinIntervalRef.current = setInterval(spin, speed);
            }
        };

        spinIntervalRef.current = setInterval(spin, speed);
    };

    const resetPicker = () => {
        setExcludedNames([]);
        setSelectedName(null);
        setDisplayName('');
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '500px', textAlign: 'center' }}
            >
                <div className="modal-header">
                    <h2 className="modal-title">🎰 สุ่มเรียกชื่อ</h2>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                <div style={{ padding: 'var(--space-xl)' }}>
                    {/* Stats */}
                    <div style={{
                        marginBottom: 'var(--space-lg)',
                        fontSize: '0.9rem',
                        color: 'var(--text-secondary)'
                    }}>
                        เหลือ {availableNames.length} / {attendanceList.length} คน
                    </div>

                    {/* Slot Machine Display */}
                    <div className={`slot-machine ${isSpinning ? 'spinning' : ''} ${selectedName ? 'winner' : ''}`}>
                        <div className="slot-display">
                            {displayName || (availableNames.length > 0 ? 'กดปุ่มเพื่อสุ่ม' : 'ไม่มีชื่อให้สุ่มแล้ว')}
                        </div>
                    </div>

                    {/* Winner Info */}
                    {selectedName && (
                        <div className="winner-info">
                            <div className="winner-id">{selectedName.studentId}</div>
                            <div className="winner-email">{selectedName.studentEmail}</div>
                        </div>
                    )}

                    {/* Already Picked List */}
                    {excludedNames.length > 0 && (
                        <div style={{
                            marginTop: 'var(--space-lg)',
                            padding: 'var(--space-md)',
                            background: 'var(--bg-glass)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.85rem'
                        }}>
                            <div style={{ marginBottom: 'var(--space-sm)', fontWeight: 500 }}>
                                ถูกสุ่มแล้ว ({excludedNames.length})
                            </div>
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 'var(--space-xs)',
                                justifyContent: 'center'
                            }}>
                                {excludedNames.map(email => {
                                    const student = attendanceList.find(a => a.studentEmail === email);
                                    return (
                                        <span
                                            key={email}
                                            style={{
                                                padding: '0.25rem 0.5rem',
                                                background: 'rgba(239, 68, 68, 0.2)',
                                                borderRadius: 'var(--radius-sm)',
                                                fontSize: '0.8rem'
                                            }}
                                        >
                                            {student?.studentName || email}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-md justify-center" style={{ marginTop: 'var(--space-xl)' }}>
                        <button
                            className="btn btn-primary btn-lg"
                            onClick={startSpin}
                            disabled={isSpinning || availableNames.length === 0}
                            style={{ minWidth: '140px' }}
                        >
                            {isSpinning ? '🎰 กำลังสุ่ม...' : '🎲 สุ่ม!'}
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={resetPicker}
                            disabled={isSpinning || excludedNames.length === 0}
                        >
                            🔄 รีเซ็ต
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
