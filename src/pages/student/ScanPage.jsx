import { useAuth } from '../../context/AuthContext';
import QRScanner from '../../components/QRScanner';

export default function ScanPage() {
    const { user } = useAuth();

    const handleSuccess = (result) => {
        console.log('Check-in successful:', result);
    };

    const handleError = (error) => {
        console.error('Check-in failed:', error);
    };

    return (
        <div className="page container">
            <div style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
                <h1>เช็คชื่อ</h1>
                <p className="text-muted mb-lg">
                    Scan QR Code ที่อาจารย์แสดงบนหน้าจอ
                </p>

                {/* Current user info */}
                <div className="card mb-lg" style={{ padding: 'var(--space-md)' }}>
                    <div className="flex items-center gap-md">
                        <div style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: 'var(--radius-full)',
                            background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 600,
                            color: 'white',
                            fontSize: '1.1rem'
                        }}>
                            {user?.displayName?.charAt(0) || user?.email?.charAt(0) || '?'}
                        </div>
                        <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 500 }}>{user?.displayName || 'ไม่ระบุชื่อ'}</div>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>{user?.email}</div>
                        </div>
                    </div>
                </div>

                {/* QR Scanner */}
                <div className="card">
                    <QRScanner onSuccess={handleSuccess} onError={handleError} />
                </div>

                <p className="text-muted mt-lg" style={{ fontSize: '0.85rem' }}>
                    กรุณาให้กล้องเข้าถึงเว็บไซต์นี้เพื่อ scan QR Code
                </p>
            </div>
        </div>
    );
}
