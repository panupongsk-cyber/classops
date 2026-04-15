import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getStudents,
    getGradeCategories,
    getClassroomGrades,
    createGradeCategory,
    updateGradeCategory,
    deleteGradeCategory,
    saveGrades,
    updateGrade,
    getGroupSets,
    getStudentGroups,
    saveGroupGrades
} from '../../firebase/firestore';

export default function Gradebook({ classroom }) {
    const { user } = useAuth();
    const [categories, setCategories] = useState([]);
    const [grades, setGrades] = useState([]);
    const [students, setStudents] = useState([]);
    const [loadingGrades, setLoadingGrades] = useState(true);

    // Modal states
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [categoryName, setCategoryName] = useState('');
    const [categoryMaxScore, setCategoryMaxScore] = useState('');

    // Import states
    const [selectedCategory, setSelectedCategory] = useState('');
    const [pasteData, setPasteData] = useState('');
    const [previewData, setPreviewData] = useState([]);
    const [showPreview, setShowPreview] = useState(false);
    const [importing, setImporting] = useState(false);

    // Group grading states
    const [gradingMode, setGradingMode] = useState('individual');
    const [groupSets, setGroupSets] = useState([]);
    const [selectedGroupSet, setSelectedGroupSet] = useState(null);
    const [groups, setGroups] = useState([]);
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [groupGradeCategory, setGroupGradeCategory] = useState('');
    const [groupGradeInputs, setGroupGradeInputs] = useState({});
    const [savingGroupGrades, setSavingGroupGrades] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            if (!classroom?.id) return;
            setLoadingGrades(true);
            try {
                const [categoriesData, gradesData, studentsData, sets] = await Promise.all([
                    getGradeCategories(classroom.id),
                    getClassroomGrades(classroom.id),
                    getStudents(classroom.id),
                    getGroupSets(classroom.id)
                ]);
                setCategories(categoriesData);
                setGrades(gradesData);
                setStudents(studentsData);
                setGroupSets(sets);
                if (sets.length > 0) setSelectedGroupSet(sets[0]);
            } catch (error) {
                console.error('Failed to load gradebook data:', error);
            } finally {
                setLoadingGrades(false);
            }
        };
        loadData();
    }, [classroom?.id]);

    useEffect(() => {
        const loadGroups = async () => {
            if (!selectedGroupSet?.id) {
                setGroups([]); return;
            }
            setLoadingGroups(true);
            try {
                const data = await getStudentGroups(selectedGroupSet.id);
                setGroups(data);
                setGroupGradeInputs({});
            } finally { setLoadingGroups(false); }
        };
        loadGroups();
    }, [selectedGroupSet?.id]);

    const handleSaveCategory = async () => {
        if (!categoryName.trim()) return;
        try {
            if (editingCategory) {
                await updateGradeCategory(editingCategory.id, { name: categoryName, maxScore: Number(categoryMaxScore) || 0 });
            } else {
                await createGradeCategory(classroom.id, categoryName, Number(categoryMaxScore) || 0);
            }
            const updated = await getGradeCategories(classroom.id);
            setCategories(updated);
            setShowCategoryModal(false);
            setCategoryName(''); setCategoryMaxScore(''); setEditingCategory(null);
        } catch (error) { alert('บันทึกไม่สำเร็จ: ' + error.message); }
    };

    const handleTogglePublish = async (category) => {
        try {
            await updateGradeCategory(category.id, { isPublished: !category.isPublished });
            setCategories(prev => prev.map(c => c.id === category.id ? { ...c, isPublished: !c.isPublished } : c));
        } catch (e) { console.error(e); }
    };

    const handlePreview = () => {
        if (!pasteData.trim() || !selectedCategory) return;
        const lines = pasteData.trim().split('\n');
        const parsed = [];
        for (const line of lines) {
            const parts = line.split(/\t|,/).map(p => p.trim());
            if (parts.length >= 2) {
                const studentId = parts[0];
                const score = parseFloat(parts[1]) || 0;
                const student = students.find(s => s.studentId === studentId);
                parsed.push({ studentId, score, studentName: student?.name || '', studentEmail: student?.email || '', found: !!student });
            }
        }
        setPreviewData(parsed); setShowPreview(true);
    };

    const handleImport = async () => {
        setImporting(true);
        try {
            const result = await saveGrades(classroom.id, selectedCategory, previewData, user?.email || '');
            alert(`บันทึกสำเร็จ!\nเพิ่มใหม่: ${result.saved}\nอัพเดท: ${result.updated}`);
            const updatedGrades = await getClassroomGrades(classroom.id);
            setGrades(updatedGrades);
            setPasteData(''); setPreviewData([]); setShowPreview(false);
        } catch (e) { alert(e.message); } finally { setImporting(false); }
    };

    if (loadingGrades) return <div className="text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div>
            {/* Header */}
            <div className="flex justify-between items-center mb-lg">
                <div>
                    <h3>สมุดคะแนน (Gradebook)</h3>
                    <p className="text-muted">จัดการคะแนนและเผยแพร่ให้นักศึกษา</p>
                </div>
                <div className="flex gap-sm">
                    <button className={`btn ${gradingMode === 'individual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setGradingMode('individual')}>👤 รายคน</button>
                    <button className={`btn ${gradingMode === 'group' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setGradingMode('group')} disabled={groupSets.length === 0}>👥 กลุ่ม</button>
                </div>
            </div>

            {/* Categories */}
            <div className="card mb-lg">
                <div className="card-header">
                    <h3 className="card-title">หมวดคะแนน</h3>
                    <button className="btn btn-primary btn-sm" onClick={() => { setEditingCategory(null); setCategoryName(''); setCategoryMaxScore(''); setShowCategoryModal(true); }}>+ สร้างหมวด</button>
                </div>
                <div className="flex flex-col gap-sm">
                    {categories.map(cat => (
                        <div key={cat.id} className="flex items-center justify-between p-md bg-secondary rounded" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                            <div><span className="font-bold">{cat.name}</span> <span className="text-muted">({cat.maxScore} pts)</span></div>
                            <div className="flex gap-sm">
                                <button className={`btn btn-sm ${cat.isPublished ? 'btn-success' : 'btn-secondary'}`} onClick={() => handleTogglePublish(cat)}>{cat.isPublished ? '✓ เผยแพร่แล้ว' : 'ยังไม่เปิดเผย'}</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => { setEditingCategory(cat); setCategoryName(cat.name); setCategoryMaxScore(cat.maxScore); setShowCategoryModal(true); }}>แก้ไข</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Import Area */}
            {categories.length > 0 && (
                <div className="card mb-lg">
                    <div className="card-header"><h3 className="card-title">Import จาก Google Sheets</h3></div>
                    <div className="flex gap-md mb-md">
                        <select className="form-input" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} style={{ flex: 1 }}>
                            <option value="">-- เลือกหมวด --</option>
                            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                        </select>
                    </div>
                    <textarea className="form-input mb-md" rows={4} placeholder="รหัสนิสิต [TAB] คะแนน" value={pasteData} onChange={e => setPasteData(e.target.value)} />
                    <div className="flex gap-md">
                        <button className="btn btn-secondary" onClick={handlePreview} disabled={!pasteData.trim() || !selectedCategory}>👁️ Preview</button>
                        <button className="btn btn-primary" onClick={handleImport} disabled={previewData.length === 0 || importing}>💾 บันทึก</button>
                    </div>
                </div>
            )}

            {/* Grades Table */}
            <div className="card overflow-x-auto">
                <table className="table w-full">
                    <thead>
                        <tr>
                            <th className="text-left p-sm">รหัส</th>
                            <th className="text-left p-sm">ชื่อ</th>
                            {categories.map(cat => <th key={cat.id} className="text-center p-sm">{cat.name}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {students.map(student => (
                            <tr key={student.id} className="border-t">
                                <td className="p-sm">{student.studentId}</td>
                                <td className="p-sm">{student.name}</td>
                                {categories.map(cat => {
                                    const grade = grades.find(g => g.studentId === student.studentId && g.categoryId === cat.id);
                                    return <td key={cat.id} className="text-center p-sm">{grade?.score ?? '-'}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Category Modal */}
            {showCategoryModal && (
                <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                        <div className="modal-header"><h2>{editingCategory ? 'แก้ไขหมวด' : 'สร้างหมวด'}</h2></div>
                        <div className="p-lg">
                            <div className="form-group"><label className="form-label">ชื่อหมวด</label><input type="text" className="form-input" value={categoryName} onChange={e => setCategoryName(e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">คะแนนเต็ม</label><input type="number" className="form-input" value={categoryMaxScore} onChange={e => setCategoryMaxScore(e.target.value)} /></div>
                            <div className="flex gap-md justify-center mt-md">
                                <button className="btn btn-secondary" onClick={() => setShowCategoryModal(false)}>ยกเลิก</button>
                                <button className="btn btn-primary" onClick={handleSaveCategory}>บันทึก</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
