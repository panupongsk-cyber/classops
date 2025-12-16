import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getStudentGrades } from '../../firebase/firestore';

export default function StudentGrades() {
    const { user } = useAuth();
    const [gradesData, setGradesData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadGrades = async () => {
            if (!user?.email) return;

            try {
                const data = await getStudentGrades(user.email);
                setGradesData(data);
            } catch (error) {
                console.error('Failed to load grades:', error);
            } finally {
                setLoading(false);
            }
        };
        loadGrades();
    }, [user?.email]);

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
            <div className="mb-lg">
                <h1 style={{ marginBottom: '0.25rem' }}>คะแนนของฉัน</h1>
                <p className="text-muted">คะแนนที่อาจารย์เผยแพร่แล้ว</p>
            </div>

            {gradesData.length === 0 ? (
                <div className="card text-center" style={{ padding: '3rem' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, margin: '0 auto 1rem' }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <h2>ยังไม่มีคะแนน</h2>
                    <p className="text-muted">อาจารย์ยังไม่ได้เผยแพร่คะแนน หรือคุณยังไม่ได้ลงทะเบียนในรายวิชา</p>
                </div>
            ) : (
                <div className="flex flex-col gap-lg">
                    {gradesData.map((classroom) => {
                        // Calculate totals only for grades that have scores (not N/A)
                        const gradesWithScore = classroom.grades.filter(g => g.score !== null);
                        const totalScore = gradesWithScore.reduce((sum, g) => sum + (g.score || 0), 0);
                        const totalMaxScore = gradesWithScore.reduce((sum, g) => sum + (g.maxScore || 0), 0);

                        return (
                            <div key={classroom.classroomId} className="card">
                                <div className="card-header">
                                    <h3 className="card-title">
                                        📚 {classroom.classroomName || 'รายวิชา'}
                                    </h3>
                                </div>

                                <div className="flex flex-col gap-sm">
                                    {classroom.grades.map((grade, idx) => (
                                        <div
                                            key={idx}
                                            style={{
                                                padding: 'var(--space-md)',
                                                background: 'var(--bg-glass)',
                                                borderRadius: 'var(--radius-md)'
                                            }}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between'
                                            }}>
                                                <span style={{ fontWeight: 500 }}>
                                                    {grade.categoryName}
                                                </span>
                                                <div style={{ textAlign: 'right' }}>
                                                    <span style={{
                                                        fontSize: '1.25rem',
                                                        fontWeight: 700,
                                                        color: grade.score !== null ? 'var(--primary-light)' : 'var(--text-muted)'
                                                    }}>
                                                        {grade.score !== null ? grade.score : 'N/A'}
                                                    </span>
                                                    <span className="text-muted" style={{ marginLeft: '0.25rem' }}>
                                                        / {grade.maxScore}
                                                    </span>
                                                </div>
                                            </div>
                                            {/* Feedback display */}
                                            {grade.feedback && (
                                                <div style={{
                                                    marginTop: 'var(--space-sm)',
                                                    padding: 'var(--space-sm)',
                                                    background: 'rgba(99, 102, 241, 0.1)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    fontSize: '0.9rem',
                                                    color: 'var(--text-secondary)'
                                                }}>
                                                    <span style={{ opacity: 0.7 }}>💬 </span>
                                                    {grade.feedback}
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {/* Total - only count grades with scores */}
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: 'var(--space-md)',
                                            background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                                            borderRadius: 'var(--radius-md)',
                                            marginTop: 'var(--space-sm)'
                                        }}
                                    >
                                        <span style={{ fontWeight: 600 }}>รวม</span>
                                        <div>
                                            <span style={{
                                                fontSize: '1.5rem',
                                                fontWeight: 700
                                            }}>
                                                {totalScore}
                                            </span>
                                            <span style={{ marginLeft: '0.25rem', opacity: 0.8 }}>
                                                / {totalMaxScore}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
