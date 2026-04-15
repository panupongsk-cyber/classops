import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import Feed from '../../components/feed/Feed';
import AttendanceHistory from '../../components/classroom/AttendanceHistory';
import PersonalGrades from '../../components/classroom/PersonalGrades';

export default function StudentClassroomHub() {
    const { id: classId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [classroom, setClassroom] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('feed'); // 'feed', 'history', 'grades'

    useEffect(() => {
        const fetchClassroom = async () => {
            if (!classId) return;
            try {
                const docRef = doc(db, 'classrooms', classId);
                const snapshot = await getDoc(docRef);
                if (snapshot.exists()) {
                    setClassroom({ id: snapshot.id, ...snapshot.data() });
                } else {
                    alert('ไม่พบชั้นเรียน');
                    navigate('/student');
                }
            } catch (error) {
                console.error('Error fetching classroom:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchClassroom();
    }, [classId, navigate]);

    if (loading) {
        return (
            <div className="page container text-center py-xl">
                <div className="spinner mb-md"></div>
                <p>กำลังโหลดข้อมูลชั้นเรียน...</p>
            </div>
        );
    }

    if (!classroom) return null;

    return (
        <div className="page container">
            {/* Class Header */}
            <div className="mb-lg">
                <div className="flex items-center gap-md mb-xs">
                    <button 
                        onClick={() => navigate('/student')} 
                        className="btn-text"
                        style={{ padding: '0.25rem 0.5rem', marginLeft: '-0.5rem' }}
                    >
                        ← กลับ
                    </button>
                    <h1 style={{ marginBottom: 0 }}>{classroom.name}</h1>
                </div>
                <p className="text-muted">{classroom.code} • {classroom.section}</p>
            </div>

            {/* Hub Tabs */}
            <div className="flex gap-md mb-lg border-b pb-xs">
                {[
                    { id: 'feed', label: '📰 ฟีดชั้นเรียน' },
                    { id: 'history', label: '📊 การเข้าเรียน' },
                    { id: 'grades', label: '📝 คะแนน' },
                ].map(tab => (
                    <button
                        key={tab.id}
                        className={`btn-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '0.5rem 1.25rem',
                            border: 'none',
                            background: 'none',
                            borderBottom: activeTab === tab.id ? '3px solid var(--primary)' : '3px solid transparent',
                            fontWeight: activeTab === tab.id ? '600' : '400',
                            color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="hub-content">
                {activeTab === 'feed' && <Feed classroomId={classId} />}
                {activeTab === 'history' && <AttendanceHistory classroomId={classId} />}
                {activeTab === 'grades' && <PersonalGrades classroomId={classId} />}
            </div>
        </div>
    );
}
