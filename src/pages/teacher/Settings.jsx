import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getClassrooms, updateClassroom } from '../../firebase/firestore';

export default function Settings() {
    const { user } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                const data = await getClassrooms(user.uid, user.email);
                setClassrooms(data);
            } catch (error) {
                console.error('Failed to load classrooms:', error);
            } finally {
                setLoading(false);
            }
        };
        loadClassrooms();
    }, [user?.uid]);

    const handleIntervalChange = (classroomId, interval) => {
        setClassrooms(prev =>
            prev.map(c =>
                c.id === classroomId ? { ...c, qrInterval: parseInt(interval) } : c
            )
        );
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            for (const classroom of classrooms) {
                await updateClassroom(classroom.id, { qrInterval: classroom.qrInterval });
            }
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="page container">
                <div className="text-center" style={{ padding: '4rem' }}>
                    <p>กำลังโหลด...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page container">
            <div style={{ maxWidth: '700px', margin: '0 auto' }}>
                <h1>ตั้งค่า</h1>
                <p className="text-muted mb-lg">ปรับแต่งการตั้งค่าระบบเช็คชื่อ</p>

                {/* QR Interval Settings */}
                <div className="card mb-lg">
                    <div className="card-header">
                        <h3 className="card-title">⏱️ ระยะเวลา QR Code</h3>
                    </div>
                    <p className="text-muted mb-lg">
                        กำหนดระยะเวลาที่ QR code จะเปลี่ยนอัตโนมัติ (วินาที) สำหรับแต่ละรายวิชา
                    </p>

                    {classrooms.length === 0 ? (
                        <div className="empty-state">
                            <p>ยังไม่มีรายวิชา</p>
                            <a href="/teacher/classrooms" className="btn btn-primary mt-md">
                                สร้างรายวิชา
                            </a>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-md">
                            {classrooms.map((classroom) => (
                                <div key={classroom.id} className="flex items-center justify-between gap-lg" style={{
                                    padding: 'var(--space-md)',
                                    background: 'var(--bg-glass)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{classroom.name}</div>
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                            {classroom.code || 'ไม่มีรหัสวิชา'}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-md">
                                        <input
                                            type="range"
                                            min="10"
                                            max="120"
                                            step="5"
                                            value={classroom.qrInterval || 30}
                                            onChange={(e) => handleIntervalChange(classroom.id, e.target.value)}
                                            style={{ width: '150px', accentColor: 'var(--primary)' }}
                                        />
                                        <span style={{
                                            minWidth: '60px',
                                            textAlign: 'right',
                                            fontWeight: 600,
                                            color: 'var(--primary-light)'
                                        }}>
                                            {classroom.qrInterval || 30} วินาที
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Interval Presets */}
                <div className="card mb-lg">
                    <div className="card-header">
                        <h3 className="card-title">📋 ค่าแนะนำ</h3>
                    </div>
                    <div className="flex flex-col gap-sm">
                        <div className="flex items-center justify-between" style={{ padding: 'var(--space-sm) 0' }}>
                            <span>🔒 ปลอดภัยสูง</span>
                            <span className="text-muted">10-15 วินาที</span>
                        </div>
                        <div className="flex items-center justify-between" style={{ padding: 'var(--space-sm) 0' }}>
                            <span>⚖️ สมดุล (แนะนำ)</span>
                            <span className="text-muted">30 วินาที</span>
                        </div>
                        <div className="flex items-center justify-between" style={{ padding: 'var(--space-sm) 0' }}>
                            <span>🏃 สะดวกรวดเร็ว</span>
                            <span className="text-muted">60-120 วินาที</span>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-between items-center">
                    {success && (
                        <div style={{
                            color: 'var(--success)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-sm)'
                        }}>
                            ✓ บันทึกสำเร็จ
                        </div>
                    )}
                    <div style={{ marginLeft: 'auto' }}>
                        <button
                            className="btn btn-primary btn-lg"
                            onClick={handleSave}
                            disabled={saving || classrooms.length === 0}
                        >
                            {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
