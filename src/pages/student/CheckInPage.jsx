import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { validateCheckInCode, getClassroom, getEmojiPool, getExitTicketByStudent } from '../../firebase/firestore';

const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const ErrorIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
);

const GoogleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
        <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24Z" />
        <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09Z" />
        <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z" />
    </svg>
);

export default function CheckInPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, userRole, signInWithGoogle, loading: authLoading, authError } = useAuth();

    const [status, setStatus] = useState('loading'); // loading, login, confirm, processing, success, error
    const [error, setError] = useState(null);
    const [classroom, setClassroom] = useState(null);
    const [studentInfo, setStudentInfo] = useState(null);

    // Emoji challenge state
    const [selectedEmojis, setSelectedEmojis] = useState([]);
    const [emojiPool] = useState(() => getEmojiPool()); // Load immediately on mount

    // Exit ticket state
    const [showExitTicket, setShowExitTicket] = useState(false);
    const [exitTicketEnabled, setExitTicketEnabled] = useState(false);
    const [exitTicketSubmitted, setExitTicketSubmitted] = useState(false);

    // Get URL parameters
    const sessionId = searchParams.get('s');
    const classroomId = searchParams.get('c');
    const token = searchParams.get('t');
    const expiry = searchParams.get('e');

    // Check if URL parameters are valid
    const hasValidParams = sessionId && classroomId && token && expiry;

    // Load classroom info
    useEffect(() => {
        const loadData = async () => {
            if (!classroomId) return;
            try {
                const data = await getClassroom(classroomId);
                setClassroom(data);
            } catch (e) {
                console.error('Failed to load classroom:', e);
            }
        };
        loadData();
    }, [classroomId]);

    // Determine status based on auth state
    useEffect(() => {
        if (authLoading) {
            setStatus('loading');
            return;
        }

        if (!hasValidParams) {
            setError('ลิงก์ไม่ถูกต้อง กรุณา scan QR Code ใหม่');
            setStatus('error');
            return;
        }

        if (!user) {
            setStatus('login');
        } else if (userRole === 'student' || userRole === null) {
            // Allow students and users not yet in system to try check-in
            // Server-side validation will determine if they're actually registered
            setStatus('confirm');
            setError(null); // Clear any previous errors
        } else {
            // Teacher/admin trying to check in
            setError('กรุณาใช้บัญชีนิสิตในการเช็คชื่อ');
            setStatus('error');
        }
    }, [authLoading, user, userRole, hasValidParams]);

    // Handle Google login
    const handleLogin = async () => {
        setError(null);
        try {
            await signInWithGoogle();
        } catch (e) {
            console.error('Login failed:', e);
            setError('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
        }
    };

    // Handle emoji selection
    const handleEmojiClick = (emoji) => {
        if (selectedEmojis.length < 3) {
            setSelectedEmojis([...selectedEmojis, emoji]);
        }
    };

    // Handle emoji removal
    const handleRemoveEmoji = (index) => {
        setSelectedEmojis(selectedEmojis.filter((_, i) => i !== index));
    };

    // Clear emoji selection
    const handleClearEmojis = () => {
        setSelectedEmojis([]);
    };

    // Handle check-in
    const handleCheckIn = async () => {
        if (!user?.email) return;

        if (selectedEmojis.length !== 3) {
            setError('กรุณาเลือก emoji 3 ตัวตามลำดับที่แสดงบนหน้าจออาจารย์');
            return;
        }

        setStatus('processing');
        setError(null);

        try {
            // Collect metadata
            const userAgent = navigator.userAgent || '';

            // Get IP address
            let ipAddress = '';
            try {
                const ipResponse = await fetch('https://api.ipify.org?format=json');
                const ipData = await ipResponse.json();
                ipAddress = ipData.ip || '';
            } catch (ipError) {
                console.log('Could not get IP address:', ipError);
            }

            // Get GPS location
            let location = null;
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 15000,
                        maximumAge: 0
                    });
                });
                location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                console.log('📍 Student location:', location);
            } catch (gpsError) {
                console.error('GPS error:', gpsError);
            }

            const metadata = {
                userAgent,
                ipAddress,
                location,
                emojiSequence: selectedEmojis
            };

            const result = await validateCheckInCode(
                sessionId,
                classroomId,
                token,
                expiry,
                user.email,
                metadata
            );

            setStudentInfo(result.student);
            if (result.classroom) {
                setClassroom(result.classroom);
            }

            // Check if exit ticket is enabled for this session
            if (result.session?.exitTicketEnabled) {
                setExitTicketEnabled(true);
                // Check if already submitted
                const existing = await getExitTicketByStudent(sessionId, user.email);
                if (!existing) {
                    setShowExitTicket(true);
                } else {
                    setExitTicketSubmitted(true);
                }
            }

            setStatus('success');
        } catch (e) {
            console.error('Check-in failed:', e);
            setError(e.message || 'เช็คชื่อไม่สำเร็จ');
            setStatus('error');
        }
    };

    // Render loading state
    if (status === 'loading') {
        return (
            <div className="page container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="text-center">
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>กำลังโหลด...</h1>
                </div>
            </div>
        );
    }

    // Render login state
    if (status === 'login') {
        return (
            <div className="page container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <h1 style={{ marginBottom: 'var(--space-md)' }}>📝 เช็คชื่อ</h1>

                    {classroom && (
                        <div style={{
                            background: 'var(--bg-glass)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-lg)',
                            marginBottom: 'var(--space-xl)'
                        }}>
                            <p className="text-muted" style={{ marginBottom: 'var(--space-xs)' }}>วิชา</p>
                            <h2 style={{ color: 'var(--primary-light)', fontSize: '1.25rem' }}>
                                {classroom.name}
                            </h2>
                        </div>
                    )}

                    <p className="text-muted" style={{ marginBottom: 'var(--space-xl)' }}>
                        กรุณาเข้าสู่ระบบด้วย Google เพื่อเช็คชื่อ
                    </p>

                    {authError && (
                        <div style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: 'var(--error)',
                            padding: 'var(--space-md)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--space-lg)'
                        }}>
                            {authError}
                        </div>
                    )}

                    <button
                        onClick={handleLogin}
                        className="btn"
                        style={{
                            width: '100%',
                            background: 'white',
                            color: '#333',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 'var(--space-md)',
                            padding: 'var(--space-md) var(--space-lg)'
                        }}
                    >
                        <GoogleIcon />
                        เข้าสู่ระบบด้วย Google
                    </button>
                </div>
            </div>
        );
    }

    // Render confirm state with emoji challenge
    if (status === 'confirm') {
        return (
            <div className="page container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ maxWidth: '450px', width: '100%', textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <h1 style={{ marginBottom: 'var(--space-md)' }}>🔐 ยืนยันเช็คชื่อ</h1>

                    {classroom && (
                        <div style={{
                            background: 'var(--bg-glass)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-md)',
                            marginBottom: 'var(--space-lg)'
                        }}>
                            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>วิชา</p>
                            <p style={{ fontWeight: 600, color: 'var(--primary-light)' }}>{classroom.name}</p>
                        </div>
                    )}

                    <div style={{
                        background: 'var(--bg-glass)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-md)',
                        marginBottom: 'var(--space-lg)'
                    }}>
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>เข้าสู่ระบบเป็น</p>
                        <p style={{ fontWeight: 600 }}>{user?.displayName || user?.email}</p>
                    </div>

                    {/* Emoji Selection */}
                    <div style={{
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-lg)',
                        marginBottom: 'var(--space-lg)'
                    }}>
                        <p style={{ marginBottom: 'var(--space-sm)', fontSize: '0.9rem' }}>
                            เลือก emoji 3 ตัวตามลำดับที่เห็นบนหน้าจออาจารย์
                        </p>

                        {/* Selected emojis display */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            gap: 'var(--space-md)',
                            marginBottom: 'var(--space-md)'
                        }}>
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    onClick={() => selectedEmojis[i] && handleRemoveEmoji(i)}
                                    style={{
                                        width: '60px',
                                        height: '60px',
                                        borderRadius: 'var(--radius-md)',
                                        background: 'rgba(255,255,255,0.2)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '2rem',
                                        cursor: selectedEmojis[i] ? 'pointer' : 'default',
                                        border: '2px dashed rgba(255,255,255,0.4)',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {selectedEmojis[i] || ''}
                                </div>
                            ))}
                        </div>

                        {selectedEmojis.length > 0 && (
                            <button
                                onClick={handleClearEmojis}
                                style={{
                                    background: 'rgba(255,255,255,0.2)',
                                    border: 'none',
                                    color: 'white',
                                    padding: '0.3rem 0.8rem',
                                    borderRadius: 'var(--radius-sm)',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}
                            >
                                ล้าง
                            </button>
                        )}
                    </div>

                    {/* Emoji Grid */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 'var(--space-sm)',
                        marginBottom: 'var(--space-lg)'
                    }}>
                        {emojiPool.map((emoji, i) => (
                            <button
                                key={i}
                                onClick={() => handleEmojiClick(emoji)}
                                disabled={selectedEmojis.length >= 3}
                                style={{
                                    fontSize: '1.8rem',
                                    padding: 'var(--space-sm)',
                                    background: 'var(--bg-glass)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: selectedEmojis.length >= 3 ? 'not-allowed' : 'pointer',
                                    opacity: selectedEmojis.length >= 3 ? 0.5 : 1,
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>

                    {error && (
                        <div style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: 'var(--error)',
                            padding: 'var(--space-md)',
                            borderRadius: 'var(--radius-md)',
                            marginBottom: 'var(--space-lg)'
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleCheckIn}
                        className="btn btn-primary"
                        disabled={selectedEmojis.length !== 3}
                        style={{
                            width: '100%',
                            padding: 'var(--space-md) var(--space-lg)',
                            fontSize: '1.1rem',
                            opacity: selectedEmojis.length !== 3 ? 0.6 : 1
                        }}
                    >
                        ✓ ยืนยันเช็คชื่อ
                    </button>
                </div>
            </div>
        );
    }

    // Render processing state
    if (status === 'processing') {
        return (
            <div className="page container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        background: 'var(--bg-glass)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto var(--space-lg)',
                        animation: 'pulse 1s infinite'
                    }}>
                        <span style={{ fontSize: '2rem' }}>⏳</span>
                    </div>
                    <h2>กำลังเช็คชื่อ...</h2>
                </div>
            </div>
        );
    }

    // Render success state
    if (status === 'success') {
        return (
            <div className="page container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <div className="result-icon success" style={{ margin: '0 auto var(--space-lg)' }}>
                        <CheckIcon />
                    </div>

                    <h1 className="result-title" style={{ color: 'var(--success)' }}>
                        เช็คชื่อสำเร็จ!
                    </h1>

                    {classroom && (
                        <p className="text-muted" style={{ marginBottom: 'var(--space-sm)' }}>
                            {classroom.name}
                        </p>
                    )}

                    {studentInfo && (
                        <p style={{ marginBottom: 'var(--space-lg)' }}>
                            {studentInfo.name} ({studentInfo.studentId})
                        </p>
                    )}

                    {/* Exit Ticket Notification Banner */}
                    {exitTicketEnabled && !exitTicketSubmitted && (
                        <div style={{
                            background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--space-md)',
                            marginBottom: 'var(--space-lg)',
                            color: 'white'
                        }}>
                            <p style={{ marginBottom: 'var(--space-sm)', fontWeight: 500 }}>
                                📝 อาจารย์เปิดให้ตอบ Exit Ticket
                            </p>
                            <button
                                onClick={() => navigate('/student')}
                                className="btn"
                                style={{
                                    background: 'rgba(255,255,255,0.2)',
                                    color: 'white',
                                    border: '1px solid rgba(255,255,255,0.3)'
                                }}
                            >
                                ไปให้ Feedback ในประวัติการเช็คชื่อ →
                            </button>
                        </div>
                    )}

                    {exitTicketSubmitted && (
                        <p className="text-muted" style={{ marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
                            ✅ ส่ง Exit Ticket แล้ว
                        </p>
                    )}

                    <button
                        onClick={() => navigate('/')}
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                    >
                        กลับหน้าหลัก
                    </button>
                </div>
            </div>
        );
    }

    // Render error state
    if (status === 'error') {
        return (
            <div className="page container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <div className="result-icon error" style={{ margin: '0 auto var(--space-lg)' }}>
                        <ErrorIcon />
                    </div>

                    <h1 className="result-title" style={{ color: 'var(--error)' }}>
                        เช็คชื่อไม่สำเร็จ
                    </h1>

                    <p className="result-message" style={{ marginBottom: 'var(--space-xl)' }}>
                        {error}
                    </p>

                    <button
                        onClick={() => {
                            setSelectedEmojis([]);
                            setError(null);
                            setStatus('confirm');
                        }}
                        className="btn"
                        style={{ width: '100%', marginBottom: 'var(--space-md)' }}
                    >
                        ลองใหม่
                    </button>

                    <button
                        onClick={() => navigate('/')}
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                    >
                        กลับหน้าหลัก
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
