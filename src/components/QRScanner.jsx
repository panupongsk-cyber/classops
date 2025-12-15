import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { validateQRCode } from '../firebase/firestore';
import { useAuth } from '../context/AuthContext';

const SuccessIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
);

const ErrorIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" x2="9" y1="9" y2="15" />
        <line x1="9" x2="15" y1="9" y2="15" />
    </svg>
);

export default function QRScanner({ onSuccess, onError }) {
    const { user } = useAuth();
    const [scanning, setScanning] = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [processing, setProcessing] = useState(false);
    const scannerRef = useRef(null);
    const scannerInstanceRef = useRef(null);
    const isInitializedRef = useRef(false);

    const handleScanSuccess = useCallback(async (decodedText) => {
        if (processing || !scannerInstanceRef.current) return;

        setProcessing(true);

        try {
            scannerInstanceRef.current.pause(true);
        } catch (e) {
            console.log('Could not pause scanner:', e);
        }

        try {
            console.log('Validating QR code...');
            const validationResult = await validateQRCode(decodedText, user.email);
            console.log('Validation result:', validationResult);

            setResult(validationResult);
            setScanning(false);

            try {
                await scannerInstanceRef.current.clear();
            } catch (e) {
                console.log('Could not clear scanner:', e);
            }

            if (onSuccess) {
                onSuccess(validationResult);
            }
        } catch (err) {
            console.error('Validation error:', err);
            setError(err.message || 'เกิดข้อผิดพลาด');
            setScanning(false);

            try {
                await scannerInstanceRef.current.clear();
            } catch (e) {
                console.log('Could not clear scanner:', e);
            }

            if (onError) {
                onError(err);
            }
        } finally {
            setProcessing(false);
        }
    }, [processing, user?.email, onSuccess, onError]);

    useEffect(() => {
        // Prevent double initialization from React StrictMode
        if (!scanning || isInitializedRef.current) return;

        // Clear any existing scanner first
        const existingElement = document.getElementById('qr-reader');
        if (existingElement) {
            existingElement.innerHTML = '';
        }

        isInitializedRef.current = true;

        const scanner = new Html5QrcodeScanner(
            "qr-reader",
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                showTorchButtonIfSupported: true,
                showZoomSliderIfSupported: true,
                rememberLastUsedCamera: true
            },
            false
        );

        scanner.render(
            handleScanSuccess,
            (errorMessage) => {
                // Ignore scan errors, they happen frequently during scanning
            }
        );

        scannerInstanceRef.current = scanner;

        return () => {
            isInitializedRef.current = false;
            if (scannerInstanceRef.current) {
                scannerInstanceRef.current.clear().catch((e) => {
                    console.log('Cleanup error:', e);
                });
                scannerInstanceRef.current = null;
            }
        };
    }, [scanning, handleScanSuccess]);

    const handleRetry = () => {
        // Clear the container before restarting
        const container = document.getElementById('qr-reader');
        if (container) {
            container.innerHTML = '';
        }
        isInitializedRef.current = false;
        setResult(null);
        setError(null);
        setScanning(true);
    };

    if (result) {
        return (
            <div className="result-container">
                <div className="result-icon success">
                    <SuccessIcon />
                </div>
                <h3 className="result-title text-success">เช็คชื่อสำเร็จ!</h3>
                <p className="result-message">
                    {result.student?.name || user?.displayName}
                </p>
                <p className="text-muted mt-md" style={{ fontSize: '0.9rem' }}>
                    รหัสนักศึกษา: {result.student?.studentId}
                </p>
                <button onClick={handleRetry} className="btn btn-secondary mt-lg">
                    Scan อีกครั้ง
                </button>
            </div>
        );
    }

    if (error) {
        return (
            <div className="result-container">
                <div className="result-icon error">
                    <ErrorIcon />
                </div>
                <h3 className="result-title text-error">เช็คชื่อไม่สำเร็จ</h3>
                <p className="result-message">{error}</p>
                <button onClick={handleRetry} className="btn btn-primary mt-lg">
                    ลองใหม่อีกครั้ง
                </button>
            </div>
        );
    }

    return (
        <div className="scanner-container">
            <div id="qr-reader" ref={scannerRef}></div>
            {processing && (
                <div className="scanner-overlay">
                    <div className="text-center">
                        <p>กำลังตรวจสอบ...</p>
                    </div>
                </div>
            )}
        </div>
    );
}
