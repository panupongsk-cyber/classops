import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getAllowedTeachers } from '../../firebase/firestore';

export default function AdminDashboard() {
    const { user } = useAuth();
    const [teacherCount, setTeacherCount] = useState('...');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Load stats in background - don't block UI
        getAllowedTeachers()
            .then(teachers => {
                setTeacherCount(teachers.length);
                setLoading(false);
            })
            .catch(error => {
                console.error('Failed to load stats:', error);
                setTeacherCount(0);
                setLoading(false);
            });
    }, []);

    // Show UI immediately - no loading spinner
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
                        to="/teacher"
                        className="btn btn-secondary"
                        style={{ justifyContent: 'center' }}
                    >
                        📊 เช็คชื่อ (Teacher Dashboard)
                    </Link>
                </div>
            </div>

            {/* Info */}
            <div className="card mt-lg">
                <div className="card-header">
                    <h3 className="card-title">วิธีใช้งาน</h3>
                </div>
                <div className="flex flex-col gap-sm" style={{ color: 'var(--text-muted)' }}>
                    <p>1. <strong>เพิ่มอาจารย์</strong> - ไปที่ "จัดการอาจารย์" แล้วเพิ่ม email ของอาจารย์</p>
                    <p>2. <strong>อาจารย์ login</strong> - อาจารย์ที่ถูกเพิ่มสามารถ login ด้วย Google ได้</p>
                    <p>3. <strong>อาจารย์เพิ่มนักศึกษา</strong> - อาจารย์จะเพิ่มนักศึกษาในวิชาของตัวเอง</p>
                </div>
            </div>
        </div>
    );
}
