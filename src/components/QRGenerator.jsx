import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateQRData, refreshSessionToken } from '../firebase/firestore';

export default function QRGenerator({ session, qrInterval = 30 }) {
    const [qrData, setQrData] = useState('');
    const [timeLeft, setTimeLeft] = useState(qrInterval);
    const [token, setToken] = useState(session?.activeToken || '');
    const [emojiSequence, setEmojiSequence] = useState(session?.activeEmoji || []);

    const refreshQR = useCallback(async () => {
        if (!session?.id) return;

        try {
            const result = await refreshSessionToken(session.id, qrInterval);
            setToken(result.token);
            setEmojiSequence(result.emojiSequence || []);
            setTimeLeft(qrInterval);
        } catch (error) {
            console.error('Failed to refresh QR:', error);
        }
    }, [session?.id, qrInterval]);

    // Generate QR data when token changes
    useEffect(() => {
        if (session?.classroomId && token) {
            const data = generateQRData(session.id, session.classroomId, token, qrInterval);
            setQrData(data);
        }
    }, [session?.id, session?.classroomId, token, qrInterval]);

    // Countdown timer
    useEffect(() => {
        if (!session?.isActive) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    refreshQR();
                    return qrInterval;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [session?.isActive, qrInterval, refreshQR]);

    // Initialize on mount
    useEffect(() => {
        if (session?.activeToken) {
            setToken(session.activeToken);
            setEmojiSequence(session.activeEmoji || []);

            // Calculate remaining time from expiry
            if (session.tokenExpiry) {
                const expiry = session.tokenExpiry.toDate?.() || new Date(session.tokenExpiry);
                const remaining = Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 1000));
                setTimeLeft(remaining > 0 ? remaining : qrInterval);
            }
        }
    }, [session, qrInterval]);

    const getTimerClass = () => {
        if (timeLeft <= 5) return 'qr-timer danger';
        if (timeLeft <= 10) return 'qr-timer warning';
        return 'qr-timer';
    };

    const formatTime = (seconds) => {
        return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    };

    if (!qrData) {
        return (
            <div className="qr-container">
                <p className="text-muted">กำลังสร้าง QR Code...</p>
            </div>
        );
    }

    return (
        <div className="qr-container">
            {/* Horizontal layout: QR Code + Emoji */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-xl)',
                flexWrap: 'wrap'
            }}>
                {/* QR Code */}
                <div className="qr-code" style={{ flexShrink: 0 }}>
                    <QRCodeSVG
                        value={qrData}
                        size={280}
                        level="H"
                        includeMargin={true}
                        bgColor="#ffffff"
                        fgColor="#0f172a"
                    />
                </div>

                {/* Emoji Challenge Display */}
                {emojiSequence.length > 0 && (
                    <div style={{
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-xl)',
                        textAlign: 'center',
                        minWidth: '200px'
                    }}>
                        <div style={{
                            fontSize: '1rem',
                            marginBottom: 'var(--space-md)',
                            opacity: 0.9
                        }}>
                            🔐 รหัสเช็คชื่อ
                        </div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--space-sm)',
                            fontSize: '3.5rem'
                        }}>
                            {emojiSequence.map((emoji, i) => (
                                <div key={i} style={{
                                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                                }}>
                                    {emoji}
                                </div>
                            ))}
                        </div>
                        <div style={{
                            fontSize: '0.85rem',
                            marginTop: 'var(--space-md)',
                            opacity: 0.8
                        }}>
                            เลือกตามลำดับ 1 → 2 → 3
                        </div>
                    </div>
                )}
            </div>

            {/* Timer */}
            <div className={getTimerClass()} style={{ marginTop: 'var(--space-lg)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>รีเฟรชใน {formatTime(timeLeft)}</span>
            </div>

            <p className="text-muted mt-md" style={{ fontSize: '0.85rem' }}>
                รหัสและ QR จะเปลี่ยนทุก {qrInterval} วินาที
            </p>
        </div>
    );
}
