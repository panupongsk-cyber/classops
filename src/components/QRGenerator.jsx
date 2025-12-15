import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { generateQRData, refreshSessionToken } from '../firebase/firestore';

export default function QRGenerator({ session, qrInterval = 30 }) {
    const [qrData, setQrData] = useState('');
    const [timeLeft, setTimeLeft] = useState(qrInterval);
    const [token, setToken] = useState(session?.activeToken || '');

    const refreshQR = useCallback(async () => {
        if (!session?.id) return;

        try {
            const result = await refreshSessionToken(session.id, qrInterval);
            setToken(result.token);
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
            <div className="qr-code">
                <QRCodeSVG
                    value={qrData}
                    size={280}
                    level="H"
                    includeMargin={true}
                    bgColor="#ffffff"
                    fgColor="#0f172a"
                />
            </div>

            <div className={getTimerClass()}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>รีเฟรชใน {formatTime(timeLeft)}</span>
            </div>

            <p className="text-muted mt-md" style={{ fontSize: '0.85rem' }}>
                QR Code จะเปลี่ยนทุก {qrInterval} วินาที
            </p>
        </div>
    );
}
