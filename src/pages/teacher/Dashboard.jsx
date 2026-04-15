import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getClassrooms, getAllClassrooms } from '../../firebase/firestore';

export default function TeacherDashboard() {
    const { user, userRole } = useAuth();
    const navigate = useNavigate();
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid, user.email);
                setClassrooms(data);
            } catch (error) {
                console.error('Failed to load classrooms:', error);
            } finally {
                setLoading(false);
            }
        };
        loadClassrooms();
    }, [user?.uid, userRole]);

    if (loading) return <div className="page container text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div className="page container">
            <div className="flex justify-between items-center mb-lg">
                <div>
                    <h1>รายวิชาของฉัน</h1>
                    <p className="text-muted">เลือกรายวิชาเพื่อจัดการกิจกรรมและการเช็คชื่อ</p>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/teacher/classrooms')}>
                    ⚙️ จัดการรายวิชา
                </button>
            </div>

            {classrooms.length === 0 ? (
                <div className="card text-center py-xl">
                    <p className="text-muted mb-md">ยังไม่มีรายวิชาในระบบ</p>
                    <button className="btn btn-primary" onClick={() => navigate('/teacher/classrooms')}>+ สร้างรายวิชาแรก</button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {classrooms.map(classroom => (
                        <div 
                            key={classroom.id} 
                            className="card classroom-card" 
                            onClick={() => navigate(`/teacher/class/${classroom.id}`)}
                            style={{ cursor: 'pointer', transition: 'all 0.2s', borderTop: '4px solid var(--primary)' }}
                        >
                            <h3 className="mb-xs">{classroom.name}</h3>
                            <p className="text-sm text-muted mb-md">{classroom.code || 'No Code'} • Section {classroom.section || '1'}</p>
                            
                            <div className="flex justify-between items-center mt-auto pt-md border-t">
                                <span className="text-xs font-bold text-primary">เข้าสู่ชั้นเรียน →</span>
                                <div className="flex gap-sm">
                                    <span className="text-xs p-xs bg-secondary rounded" style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px' }}>
                                        {classroom.qrInterval || 30}s QR
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
