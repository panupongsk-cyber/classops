import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getAllowedTeachers, getAdminConfig, updateAdminConfig, DEFAULT_CHECKIN_RADIUS } from '../../firebase/firestore';

// Default values
const DEFAULT_QR_INTERVAL = 30;
const DEFAULT_GRACE_PERIOD = 10;
const DEFAULT_REQUIRE_GPS = true;

export default function AdminDashboard() {
    const { user } = useAuth();
    const [teacherCount, setTeacherCount] = useState('...');
    const [loading, setLoading] = useState(true);

    // Config states
    const [checkInRadius, setCheckInRadius] = useState(DEFAULT_CHECKIN_RADIUS);
    const [qrInterval, setQrInterval] = useState(DEFAULT_QR_INTERVAL);
    const [gracePeriod, setGracePeriod] = useState(DEFAULT_GRACE_PERIOD);
    const [requireGPS, setRequireGPS] = useState(DEFAULT_REQUIRE_GPS);

    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        // Load stats and config
        Promise.all([
            getAllowedTeachers(),
            getAdminConfig()
        ]).then(([teachers, config]) => {
            setTeacherCount(teachers.length);
            setCheckInRadius(config.checkInRadius || DEFAULT_CHECKIN_RADIUS);
            setQrInterval(config.qrInterval || DEFAULT_QR_INTERVAL);
            setGracePeriod(config.gracePeriod || DEFAULT_GRACE_PERIOD);
            setRequireGPS(config.requireGPS !== false); // Default true
            setLoading(false);
        }).catch(error => {
            console.error('Failed to load data:', error);
            setTeacherCount(0);
            setLoading(false);
        });
    }, []);

    const handleSaveConfig = async () => {
        setSaving(true);
        setSaved(false);
        try {
            await updateAdminConfig({
                checkInRadius: parseInt(checkInRadius, 10),
                qrInterval: parseInt(qrInterval, 10),
                gracePeriod: parseInt(gracePeriod, 10),
                requireGPS
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (error) {
            console.error('Failed to save config:', error);
            alert('บันทึกไม่สำเร็จ: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page container">
            <div className="mb-lg">
                <h1 style={{ marginBottom: '0.25rem' }}>Admin Dashboard</h1>
                <p className="text-muted">ยินดีต้อนรับ {user?.displayName || user?.email}</p>
            </div>

            {/* Stats */}
            <div className="stats-grid" style={{ marginBottom: 'var(--space-xl)' }}>
                <div className="stat-card">
                    <div className="stat-value" style={{ opacity: loading ? 0.5 : 1 }}>
                        {teacherCount}
                    </div>
                    <div className="stat-label">อาจารย์ในระบบ</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{checkInRadius}m</div>
                    <div className="stat-label">รัศมีเช็คชื่อ</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{qrInterval}s</div>
                    <div className="stat-label">Refresh ทุก</div>
                </div>
            </div>

            {/* GPS Settings */}
            <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                <div className="card-header">
                    <h3 className="card-title">⚙️ ตั้งค่าระบบ</h3>
                </div>
                <div className="flex flex-col gap-lg">
                    {/* GPS Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ position: 'relative', width: '48px', height: '24px' }}>
                            <input
                                type="checkbox"
                                id="gps-toggle"
                                checked={requireGPS}
                                onChange={(e) => setRequireGPS(e.target.checked)}
                                style={{
                                    opacity: 0,
                                    width: 0,
                                    height: 0
                                }}
                            />
                            <label
                                htmlFor="gps-toggle"
                                style={{
                                    position: 'absolute',
                                    cursor: 'pointer',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    backgroundColor: requireGPS ? '#22c55e' : '#ef4444',
                                    transition: '.4s',
                                    borderRadius: '34px'
                                }}
                            >
                                <span style={{
                                    position: 'absolute',
                                    content: '',
                                    height: '16px',
                                    width: '16px',
                                    left: requireGPS ? '26px' : '4px',
                                    bottom: '4px',
                                    backgroundColor: 'white',
                                    transition: '.4s',
                                    borderRadius: '50%'
                                }}></span>
                            </label>
                        </div>
                        <div>
                            <label htmlFor="gps-toggle" style={{ fontWeight: 500, cursor: 'pointer' }}>
                                บังคับตรวจสอบตำเเหน่ง GPS
                            </label>
                            <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                หากปิด นิสิตจะสามารถเช็คชื่อได้จากทุกที่ (สำหรับเรียน Online)
                            </div>
                        </div>
                    </div>
                    {/* GPS Radius */}
                    <div>
                        <label className="form-label">📍 รัศมีที่อนุญาตเช็คชื่อ (เมตร)</label>
                        <input
                            type="number"
                            className="form-input"
                            value={checkInRadius}
                            onChange={(e) => setCheckInRadius(e.target.value)}
                            min="10"
                            max="10000"
                            style={{ width: '150px' }}
                        />
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                            นิสิตต้องอยู่ในรัศมีนี้จากตำแหน่งอาจารย์จึงจะเช็คชื่อได้
                        </p>
                    </div>

                    {/* QR Interval */}
                    <div>
                        <label className="form-label">⏱️ ระยะเวลาเปลี่ยน Emoji/QR (วินาที)</label>
                        <input
                            type="number"
                            className="form-input"
                            value={qrInterval}
                            onChange={(e) => setQrInterval(e.target.value)}
                            min="10"
                            max="300"
                            style={{ width: '150px' }}
                        />
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                            Emoji และ QR Code จะเปลี่ยนทุกกี่วินาที (10-300)
                        </p>
                    </div>

                    {/* Grace Period */}
                    <div>
                        <label className="form-label">⏳ Grace Period (วินาที)</label>
                        <input
                            type="number"
                            className="form-input"
                            value={gracePeriod}
                            onChange={(e) => setGracePeriod(e.target.value)}
                            min="0"
                            max="60"
                            style={{ width: '150px' }}
                        />
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                            หลัง Emoji เปลี่ยน นิสิตยังใช้ Emoji เก่าได้อีกกี่วินาที (เผื่อกรอกช้า)
                        </p>
                    </div>

                    {/* Save Button */}
                    <button
                        className="btn btn-primary"
                        onClick={handleSaveConfig}
                        disabled={saving}
                        style={{ alignSelf: 'flex-start' }}
                    >
                        {saving ? 'กำลังบันทึก...' : saved ? '✓ บันทึกแล้ว' : '💾 บันทึกการตั้งค่า'}
                    </button>
                </div>
            </div>

            {/* Quick Links */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">เมนูด่วน</h3>
                </div>
                <div className="flex flex-col gap-md">
                    <Link
                        to="/admin/teachers"
                        className="btn btn-primary"
                        style={{ justifyContent: 'center' }}
                    >
                        👨‍🏫 จัดการอาจารย์
                    </Link>
                    <Link
                        to="/admin/attendance"
                        className="btn btn-secondary"
                        style={{ justifyContent: 'center' }}
                    >
                        📋 ประวัติการเช็คชื่อ
                    </Link>
                    <Link
                        to="/teacher"
                        className="btn btn-secondary"
                        style={{ justifyContent: 'center' }}
                    >
                        📊 เช็คชื่อ (Teacher Dashboard)
                    </Link>
                </div>
            </div>
        </div>
    );
}
