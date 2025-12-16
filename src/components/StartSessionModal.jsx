import { useState } from 'react';
import Modal from './Modal';

export default function StartSessionModal({
    isOpen,
    onClose,
    onStart,
    adminRequireGPS = true,
    classroom
}) {
    const [useGPS, setUseGPS] = useState(adminRequireGPS);
    const [loading, setLoading] = useState(false);
    const [gettingLocation, setGettingLocation] = useState(false);

    const handleStart = async () => {
        setLoading(true);
        try {
            let location = null;

            if (useGPS) {
                setGettingLocation(true);
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
                } catch (gpsError) {
                    console.warn('GPS error:', gpsError);
                    const proceed = confirm(
                        'ไม่สามารถเข้าถึงตำแหน่ง GPS ได้\n\n' +
                        'ต้องการเริ่มเช็คชื่อโดยไม่ตรวจสอบตำแหน่งหรือไม่?'
                    );
                    if (!proceed) {
                        setLoading(false);
                        setGettingLocation(false);
                        return;
                    }
                }
                setGettingLocation(false);
            }

            await onStart({ useGPS, location });
            onClose();
        } catch (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            setLoading(false);
            setGettingLocation(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="🎯 เริ่มเช็คชื่อ"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        ยกเลิก
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleStart}
                        disabled={loading}
                    >
                        {gettingLocation ? '📍 กำลังหาตำแหน่ง...' :
                            loading ? 'กำลังเริ่ม...' : '▶️ เริ่มเช็คชื่อ'}
                    </button>
                </>
            }
        >
            <div style={{ marginBottom: 'var(--space-lg)' }}>
                <p><strong>รายวิชา:</strong> {classroom?.name}</p>
                {classroom?.code && <p><strong>รหัส:</strong> {classroom?.code}</p>}
                <p><strong>QR Interval:</strong> {classroom?.qrInterval || 30} วินาที</p>
            </div>

            <div style={{
                padding: 'var(--space-md)',
                background: 'var(--bg-glass)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-md)'
            }}>
                <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    cursor: 'pointer'
                }}>
                    <input
                        type="checkbox"
                        checked={useGPS}
                        onChange={(e) => setUseGPS(e.target.checked)}
                        style={{ width: '20px', height: '20px' }}
                    />
                    <span>📍 ตรวจสอบตำแหน่ง GPS</span>
                </label>

                <p className="text-muted" style={{
                    fontSize: '0.85rem',
                    marginTop: 'var(--space-sm)',
                    marginLeft: '28px'
                }}>
                    {useGPS
                        ? 'นิสิตต้องอยู่ในระยะที่กำหนดจึงจะเช็คชื่อได้'
                        : 'นิสิตสามารถเช็คชื่อได้จากทุกที่ (ไม่ตรวจตำแหน่ง)'
                    }
                </p>
            </div>

            {useGPS && (
                <div style={{
                    padding: 'var(--space-sm) var(--space-md)',
                    background: 'rgba(245, 158, 11, 0.1)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.85rem'
                }}>
                    💡 <strong>Tip:</strong> ถ้าใช้ laptop ตำแหน่งอาจคลาดเคลื่อน สามารถอัพเดทตำแหน่งจากมือถือได้หลังเปิด session
                </div>
            )}
        </Modal>
    );
}
