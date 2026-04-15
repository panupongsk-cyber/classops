import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getGradeCategories, getClassroomGrades } from '../../firebase/firestore';

export default function PersonalGrades({ classroomId }) {
    const { user } = useAuth();
    const [categories, setCategories] = useState([]);
    const [grades, setGrades] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadGrades = async () => {
            if (!user?.email || !classroomId) return;
            setLoading(true);
            try {
                const [cats, allGrades] = await Promise.all([
                    getGradeCategories(classroomId),
                    getClassroomGrades(classroomId)
                ]);
                // Only show published categories to students
                setCategories(cats.filter(c => c.isPublished));
                // Filter for this student's grades
                setGrades(allGrades.filter(g => g.studentEmail === user.email.toLowerCase()));
            } finally { setLoading(false); }
        };
        loadGrades();
    }, [user?.email, classroomId]);

    if (loading) return <div className="text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div className="card">
            <div className="card-header"><h3 className="card-title">คะแนนของฉัน</h3></div>
            {categories.length === 0 ? <p className="text-center p-xl text-muted">ยังไม่มีการประกาศคะแนน</p> : (
                <div className="flex flex-col gap-sm">
                    {categories.map(cat => {
                        const grade = grades.find(g => g.categoryId === cat.id);
                        return (
                            <div key={cat.id} className="flex justify-between items-center p-md border-b">
                                <span className="font-bold">{cat.name}</span>
                                <div>
                                    <span className="text-primary font-bold text-lg">{grade?.score ?? '-'}</span>
                                    <span className="text-muted ml-xs">/ {cat.maxScore}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
