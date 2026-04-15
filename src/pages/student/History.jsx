import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getStudentClassrooms } from '../../firebase/firestore';

export default function StudentDashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            if (!user?.email) return;
            try {
                const data = await getStudentClassrooms(user.email);
                setClassrooms(data);
            } catch (error) {
                console.error('Failed to load student classrooms:', error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [user?.email]);

    if (loading) return <div className="page container text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div className="page container">
            <div className="mb-lg">
                <h1>ชั้นเรียนของฉัน</h1>
                <p className="text-muted">เลือกรายวิชาเพื่อดูประกาศและประวัติการเช็คชื่อ</p>
            </div>

            {classrooms.length === 0 ? (
                <div className="card text-center py-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, margin: '0 auto 1rem' }}>
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    <p className="text-muted">คุณยังไม่ได้ลงทะเบียนในชั้นเรียนใดๆ</p>
                    <p className="text-sm">กรุณาติดต่ออาจารย์ผู้สอนเพื่อเพิ่มชื่อเข้าในระบบ</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {classrooms.map(classroom => (
                        <div 
                            key={classroom.id} 
                            className="card classroom-card" 
                            onClick={() => navigate(`/student/class/${classroom.id}`)}
                            style={{ cursor: 'pointer', transition: 'all 0.2s', borderTop: '4px solid var(--primary)' }}
                        >
                            <h3 className="mb-xs">{classroom.name}</h3>
                            <p className="text-sm text-muted mb-md">{classroom.code || 'No Code'}</p>
                            
                            <div className="flex justify-between items-center mt-auto pt-md border-t">
                                <span className="text-xs font-bold text-primary">เข้าสู่ห้องเรียน →</span>
                                <span className="text-xs text-muted">Sec {classroom.section || '1'}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
