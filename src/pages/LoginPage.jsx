import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const GoogleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
);

export default function LoginPage() {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showEmailLogin, setShowEmailLogin] = useState(false);
    const { signInWithGoogle, signInWithEmail, authError, clearError } = useAuth();
    const navigate = useNavigate();

    const handleGoogleSignIn = async () => {
        clearError();
        setLoading(true);

        try {
            await signInWithGoogle();
            // Navigation will be handled by auth state change
        } catch (err) {
            console.error('Google sign-in error:', err);
            if (err.code === 'auth/popup-closed-by-user') {
                // User cancelled, do nothing
            } else if (err.code === 'auth/popup-blocked') {
                alert('Popup ถูกบล็อก กรุณาอนุญาต popup ในเบราว์เซอร์');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleEmailSignIn = async (e) => {
        e?.preventDefault();
        if (!email || !password) return;

        clearError();
        setLoading(true);

        try {
            await signInWithEmail(email, password);
        } catch (err) {
            console.error('Email sign-in error:', err);
            if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                alert('รหัสผ่านไม่ถูกต้อง');
            } else if (err.code === 'auth/invalid-email') {
                alert('รูปแบบ Email ไม่ถูกต้อง');
            } else {
                alert('เข้าสู่ระบบไม่สำเร็จ: ' + (err.message || err.code));
            }
        } finally {
            setLoading(false);
        }
    };

    const handleTestLogin = async (testEmail, testPassword) => {
        setEmail(testEmail);
        setPassword(testPassword);
        clearError();
        setLoading(true);

        try {
            await signInWithEmail(testEmail, testPassword);
        } catch (err) {
            console.error('Test login error:', err);
            alert('เข้าสู่ระบบไม่สำเร็จ: ' + (err.message || err.code));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
            <div className="card" style={{ maxWidth: '420px', width: '100%' }}>
                <div className="text-center mb-lg">
                    <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>ClassOps</h1>
                    <p className="text-muted">ระบบเช็คชื่อด้วย QR Code</p>
                </div>

                {authError && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-md)',
                        marginBottom: 'var(--space-lg)',
                        color: 'var(--error)',
                        textAlign: 'center'
                    }}>
                        {authError}
                    </div>
                )}

                <button
                    onClick={handleGoogleSignIn}
                    className="btn btn-lg w-full"
                    disabled={loading}
                    style={{
                        background: 'white',
                        color: '#333',
                        border: '1px solid #ddd',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.75rem',
                        fontWeight: 500
                    }}
                >
                    <GoogleIcon />
                    {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบด้วย Google'}
                </button>

                {/* Divider */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    margin: 'var(--space-lg) 0',
                    gap: 'var(--space-md)'
                }}>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>หรือ</span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                </div>

                {/* Email/Password Section */}
                {!showEmailLogin ? (
                    <button
                        onClick={() => setShowEmailLogin(true)}
                        className="btn btn-secondary w-full"
                    >
                        📧 เข้าสู่ระบบด้วย Email
                    </button>
                ) : (
                    <form onSubmit={handleEmailSignIn}>
                        <div className="form-group">
                            <input
                                type="email"
                                className="form-input"
                                placeholder="Email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <input
                                type="password"
                                className="form-input"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                        <button
                            type="submit"
                            className="btn btn-primary w-full"
                            disabled={loading || !email || !password}
                        >
                            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                        </button>
                    </form>
                )}

                {/* Test Accounts (Dev Mode) */}
                {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                    <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--border-color)' }}>
                        <p className="text-muted text-center" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-md)' }}>
                            🧪 Test Accounts (Dev Only)
                        </p>
                        <div className="flex gap-sm">
                            <button
                                onClick={() => handleTestLogin('teacher@test.com', 'test1234')}
                                className="btn btn-secondary"
                                style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                                disabled={loading}
                            >
                                👨‍🏫 Teacher
                            </button>
                            <button
                                onClick={() => handleTestLogin('student@test.com', 'test1234')}
                                className="btn btn-secondary"
                                style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                                disabled={loading}
                            >
                                👨‍🎓 Student
                            </button>
                        </div>
                        <p className="text-muted text-center" style={{ fontSize: '0.7rem', marginTop: 'var(--space-sm)' }}>
                            ⚠️ ต้องเปิด Email/Password ใน Firebase Console ก่อน
                        </p>
                    </div>
                )}

                <div className="text-center mt-lg">
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                        เฉพาะอาจารย์และนักศึกษาที่ลงทะเบียนในระบบ
                    </p>
                </div>
            </div>
        </div>
    );
}
