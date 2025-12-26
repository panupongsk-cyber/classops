import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getClassrooms,
    getAllClassrooms,
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
import Modal from '../../components/Modal';

export default function GradesPage() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [categories, setCategories] = useState([]);
    const [grades, setGrades] = useState([]);
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingGrades, setLoadingGrades] = useState(false);

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
    const [gradingMode, setGradingMode] = useState('individual'); // 'individual' or 'group'
    const [groupSets, setGroupSets] = useState([]);
    const [selectedGroupSet, setSelectedGroupSet] = useState(null);
    const [groups, setGroups] = useState([]);
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [groupGradeCategory, setGroupGradeCategory] = useState('');
    const [groupGradeInputs, setGroupGradeInputs] = useState({});
    const [savingGroupGrades, setSavingGroupGrades] = useState(false);

    // Load classrooms
    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid, user.email);

                setClassrooms(data);
                if (data.length > 0 && !selectedClassroom) {
                    setSelectedClassroom(data[0]);
                }
            } catch (error) {
                console.error('Failed to load classrooms:', error);
            } finally {
                setLoading(false);
            }
        };
        loadClassrooms();
    }, [user?.uid, userRole]);

    // Load categories, grades, and students when classroom changes
    useEffect(() => {
        const loadData = async () => {
            if (!selectedClassroom?.id) return;

            setLoadingGrades(true);
            try {
                const [categoriesData, gradesData, studentsData] = await Promise.all([
                    getGradeCategories(selectedClassroom.id),
                    getClassroomGrades(selectedClassroom.id),
                    getStudents(selectedClassroom.id)
                ]);
                setCategories(categoriesData);
                setGrades(gradesData);
                setStudents(studentsData);
            } catch (error) {
                console.error('Failed to load data:', error);
            } finally {
                setLoadingGrades(false);
            }
        };
        loadData();
    }, [selectedClassroom?.id]);

    // Load group sets when classroom changes
    useEffect(() => {
        const loadGroupSets = async () => {
            if (!selectedClassroom?.id) {
                setGroupSets([]);
                return;
            }
            try {
                const sets = await getGroupSets(selectedClassroom.id);
                setGroupSets(sets);
                if (sets.length > 0) {
                    setSelectedGroupSet(sets[0]);
                } else {
                    setSelectedGroupSet(null);
                    setGroups([]);
                }
            } catch (error) {
                console.error('Failed to load group sets:', error);
            }
        };
        loadGroupSets();
    }, [selectedClassroom?.id]);

    // Load groups when selected set changes
    useEffect(() => {
        const loadGroups = async () => {
            if (!selectedGroupSet?.id) {
                setGroups([]);
                return;
            }
            setLoadingGroups(true);
            try {
                const groupsData = await getStudentGroups(selectedGroupSet.id);
                setGroups(groupsData);
                // Reset inputs
                setGroupGradeInputs({});
            } catch (error) {
                console.error('Failed to load groups:', error);
            } finally {
                setLoadingGroups(false);
            }
        };
        loadGroups();
    }, [selectedGroupSet?.id]);

    // Handle group grade save
    const handleSaveGroupGrades = async () => {
        if (!groupGradeCategory) {
            alert('กรุณาเลือกหมวดคะแนน');
            return;
        }

        const groupsWithScores = Object.entries(groupGradeInputs).filter(
            ([_, score]) => score !== '' && score !== undefined
        );

        if (groupsWithScores.length === 0) {
            alert('กรุณาใส่คะแนนอย่างน้อย 1 กลุ่ม');
            return;
        }

        setSavingGroupGrades(true);
        try {
            let totalSaved = 0;
            let totalUpdated = 0;

            for (const [groupId, score] of groupsWithScores) {
                const result = await saveGroupGrades(
                    selectedClassroom.id,
                    groupGradeCategory,
                    groupId,
                    score,
                    user?.email || ''
                );
                totalSaved += result.saved;
                totalUpdated += result.updated;
            }

            alert(`บันทึกสำเร็จ!\nเพิ่มใหม่: ${totalSaved}\nอัพเดท: ${totalUpdated}`);

            // Refresh grades
            const updatedGrades = await getClassroomGrades(selectedClassroom.id);
            setGrades(updatedGrades);
            setGroupGradeInputs({});
        } catch (error) {
            console.error('Failed to save group grades:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            setSavingGroupGrades(false);
        }
    };

    // Category management
    const handleSaveCategory = async () => {
        if (!categoryName.trim()) return;

        try {
            if (editingCategory) {
                await updateGradeCategory(editingCategory.id, {
                    name: categoryName,
                    maxScore: Number(categoryMaxScore) || 0
                });
            } else {
                await createGradeCategory(
                    selectedClassroom.id,
                    categoryName,
                    Number(categoryMaxScore) || 0
                );
            }

            // Refresh categories
            const updated = await getGradeCategories(selectedClassroom.id);
            setCategories(updated);

            setShowCategoryModal(false);
            setCategoryName('');
            setCategoryMaxScore('');
            setEditingCategory(null);
        } catch (error) {
            console.error('Failed to save category:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    const handleDeleteCategory = async (category) => {
        if (!confirm(`ลบหมวด "${category.name}" และคะแนนทั้งหมดในหมวดนี้?`)) return;

        try {
            await deleteGradeCategory(category.id);
            const updated = await getGradeCategories(selectedClassroom.id);
            setCategories(updated);
            const updatedGrades = await getClassroomGrades(selectedClassroom.id);
            setGrades(updatedGrades);
        } catch (error) {
            console.error('Failed to delete category:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    const handleTogglePublish = async (category) => {
        try {
            await updateGradeCategory(category.id, {
                isPublished: !category.isPublished
            });
            const updated = await getGradeCategories(selectedClassroom.id);
            setCategories(updated);
        } catch (error) {
            console.error('Failed to toggle publish:', error);
        }
    };

    // Parse pasted data
    const handlePreview = () => {
        if (!pasteData.trim() || !selectedCategory) return;

        const lines = pasteData.trim().split('\n');
        const parsed = [];

        for (const line of lines) {
            const parts = line.split(/\t|,/).map(p => p.trim());
            if (parts.length >= 2) {
                const studentId = parts[0];
                const score = parseFloat(parts[1]) || 0;

                // Find student info from registered students
                const student = students.find(s => s.studentId === studentId);

                parsed.push({
                    studentId,
                    score,
                    studentName: student?.name || parts[2] || '',
                    studentEmail: student?.email || '',
                    found: !!student
                });
            }
        }

        setPreviewData(parsed);
        setShowPreview(true);
    };

    const handleImport = async () => {
        if (previewData.length === 0 || !selectedCategory) return;

        setImporting(true);
        try {
            const result = await saveGrades(
                selectedClassroom.id,
                selectedCategory,
                previewData,
                user?.email || ''
            );

            alert(`บันทึกสำเร็จ!\nเพิ่มใหม่: ${result.saved}\nอัพเดท: ${result.updated}\nผิดพลาด: ${result.errors.length}`);

            // Refresh grades
            const updatedGrades = await getClassroomGrades(selectedClassroom.id);
            setGrades(updatedGrades);

            // Clear form
            setPasteData('');
            setPreviewData([]);
            setShowPreview(false);
            setSelectedCategory('');
        } catch (error) {
            console.error('Failed to import:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            setImporting(false);
        }
    };

    // Inline edit states
    const [editingCell, setEditingCell] = useState(null); // { studentId, categoryId }
    const [editValue, setEditValue] = useState('');

    // Get grade for specific student and category
    const getGradeData = (studentId, categoryId) => {
        return grades.find(g => g.studentId === studentId && g.categoryId === categoryId);
    };

    const getGradeValue = (studentId, categoryId) => {
        const grade = getGradeData(studentId, categoryId);
        return grade?.score ?? '-';
    };

    // Handle inline edit
    const handleCellClick = (studentId, categoryId, currentValue) => {
        setEditingCell({ studentId, categoryId });
        setEditValue(currentValue === '-' ? '' : currentValue.toString());
    };

    const handleCellBlur = async () => {
        if (!editingCell) return;

        const { studentId, categoryId } = editingCell;
        const existingGrade = getGradeData(studentId, categoryId);
        const newScore = editValue === '' ? 0 : parseFloat(editValue);

        try {
            if (existingGrade) {
                // Update existing grade
                await updateGrade(existingGrade.id, newScore, user?.email || '');
            } else {
                // Create new grade
                const student = students.find(s => s.studentId === studentId);
                await saveGrades(
                    selectedClassroom.id,
                    categoryId,
                    [{
                        studentId,
                        score: newScore,
                        studentName: student?.name || '',
                        studentEmail: student?.email || ''
                    }],
                    user?.email || ''
                );
            }

            // Refresh grades
            const updatedGrades = await getClassroomGrades(selectedClassroom.id);
            setGrades(updatedGrades);
        } catch (error) {
            console.error('Failed to update grade:', error);
            alert('บันทึกไม่สำเร็จ: ' + error.message);
        }

        setEditingCell(null);
        setEditValue('');
    };

    // Export grades to CSV
    const exportGradesCSV = () => {
        if (students.length === 0 || categories.length === 0) {
            alert('ไม่มีข้อมูลคะแนน');
            return;
        }

        // Build header row
        const headers = ['รหัสนิสิต', 'ชื่อ-นามสกุล', ...categories.map(cat => `${cat.name} (${cat.maxScore})`)];

        // Build data rows
        const rows = students.map(student => {
            const row = [student.studentId, student.name];
            for (const cat of categories) {
                const grade = grades.find(g => g.studentId === student.studentId && g.categoryId === cat.id);
                row.push(grade?.score ?? '-');
            }
            return row.join(',');
        });

        const csvContent = [
            headers.join(','),
            ...rows
        ].join('\n');

        // Download file
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const classroomName = selectedClassroom?.name || 'classroom';
        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `${classroomName}_grades_${dateStr}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleCellKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleCellBlur();
        } else if (e.key === 'Escape') {
            setEditingCell(null);
            setEditValue('');
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

    if (classrooms.length === 0) {
        return (
            <div className="page container">
                <div className="card text-center">
                    <h2>ยังไม่มีรายวิชา</h2>
                    <p className="text-muted mb-lg">สร้างรายวิชาก่อนจัดการคะแนน</p>
                    <a href="/teacher/classrooms" className="btn btn-primary">+ สร้างรายวิชา</a>
                </div>
            </div>
        );
    }

    return (
        <div className="page container">
            {/* Header */}
            <div className="flex justify-between items-center mb-lg">
                <div>
                    <h1 style={{ marginBottom: '0.25rem' }}>จัดการคะแนน</h1>
                    <p className="text-muted">สร้างหมวดคะแนนและ import จาก Google Sheets</p>
                </div>

                <select
                    className="form-input form-select"
                    value={selectedClassroom?.id || ''}
                    onChange={(e) => {
                        const classroom = classrooms.find(c => c.id === e.target.value);
                        setSelectedClassroom(classroom);
                        setCategories([]);
                        setGrades([]);
                    }}
                    style={{ width: 'auto', minWidth: '200px' }}
                >
                    {classrooms.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name} {c.code ? `(${c.code})` : ''}
                        </option>
                    ))}
                </select>
            </div>

            {loadingGrades ? (
                <div className="text-center" style={{ padding: '2rem' }}>
                    <p className="text-muted">กำลังโหลด...</p>
                </div>
            ) : (
                <>
                    {/* Grading Mode Toggle */}
                    <div className="card mb-lg" style={{ padding: 'var(--space-md)' }}>
                        <div className="flex items-center gap-lg">
                            <span style={{ fontWeight: 500 }}>โหมดให้คะแนน:</span>
                            <div className="flex gap-sm">
                                <button
                                    className={`btn ${gradingMode === 'individual' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setGradingMode('individual')}
                                    style={{ padding: '0.4rem 1rem' }}
                                >
                                    👤 รายบุคคล
                                </button>
                                <button
                                    className={`btn ${gradingMode === 'group' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setGradingMode('group')}
                                    disabled={groupSets.length === 0}
                                    style={{ padding: '0.4rem 1rem' }}
                                    title={groupSets.length === 0 ? 'ยังไม่มีรอบการจัดกลุ่ม' : ''}
                                >
                                    👥 กลุ่ม
                                </button>
                            </div>
                            {groupSets.length === 0 && (
                                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    (<a href="/teacher/groups">สร้างกลุ่มก่อน</a>)
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Group Grading Mode */}
                    {gradingMode === 'group' && (
                        <div className="card mb-lg">
                            <div className="card-header">
                                <h3 className="card-title">ให้คะแนนแบบกลุ่ม</h3>
                            </div>

                            <div style={{ padding: 'var(--space-md)' }}>
                                {/* Select Group Set */}
                                <div className="flex gap-md mb-md flex-wrap items-center">
                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">รอบ</label>
                                        <select
                                            className="form-input form-select"
                                            value={selectedGroupSet?.id || ''}
                                            onChange={(e) => {
                                                const set = groupSets.find(s => s.id === e.target.value);
                                                setSelectedGroupSet(set || null);
                                            }}
                                            style={{ minWidth: '180px' }}
                                        >
                                            {groupSets.map(set => (
                                                <option key={set.id} value={set.id}>{set.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="form-group" style={{ margin: 0 }}>
                                        <label className="form-label">หมวดคะแนน</label>
                                        <select
                                            className="form-input form-select"
                                            value={groupGradeCategory}
                                            onChange={(e) => setGroupGradeCategory(e.target.value)}
                                            style={{ minWidth: '200px' }}
                                        >
                                            <option value="">-- เลือกหมวด --</option>
                                            {categories.map(cat => (
                                                <option key={cat.id} value={cat.id}>
                                                    {cat.name} ({cat.maxScore} คะแนน)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {loadingGroups ? (
                                    <div className="text-center text-muted" style={{ padding: '2rem' }}>
                                        กำลังโหลดกลุ่ม...
                                    </div>
                                ) : groups.length === 0 ? (
                                    <div className="text-center text-muted" style={{ padding: '2rem' }}>
                                        ยังไม่มีกลุ่มในรอบนี้
                                        <br />
                                        <a href="/teacher/groups" className="btn btn-primary mt-md">
                                            ไปจัดกลุ่ม
                                        </a>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex flex-col gap-sm">
                                            {groups.map(group => (
                                                <div
                                                    key={group.id}
                                                    className="flex items-center gap-md"
                                                    style={{
                                                        padding: 'var(--space-md)',
                                                        background: 'var(--bg-glass)',
                                                        borderRadius: 'var(--radius-md)',
                                                        borderLeft: `4px solid ${group.color || '#6366F1'}`
                                                    }}
                                                >
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontWeight: 500 }}>{group.name}</div>
                                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                                            {(group.studentIds || []).length} คน
                                                        </div>
                                                    </div>
                                                    <input
                                                        type="number"
                                                        className="form-input"
                                                        placeholder="คะแนน"
                                                        value={groupGradeInputs[group.id] || ''}
                                                        onChange={(e) => setGroupGradeInputs(prev => ({
                                                            ...prev,
                                                            [group.id]: e.target.value
                                                        }))}
                                                        style={{ width: '100px', textAlign: 'center' }}
                                                        step="0.5"
                                                        min="0"
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex justify-center mt-lg">
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleSaveGroupGrades}
                                                disabled={savingGroupGrades || !groupGradeCategory}
                                            >
                                                {savingGroupGrades ? 'กำลังบันทึก...' : '💾 บันทึกคะแนน'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Categories Section */}
                    <div className="card mb-lg">
                        <div className="card-header">
                            <h3 className="card-title">หมวดคะแนน</h3>
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    setEditingCategory(null);
                                    setCategoryName('');
                                    setCategoryMaxScore('');
                                    setShowCategoryModal(true);
                                }}
                            >
                                + สร้างหมวด
                            </button>
                        </div>

                        {categories.length === 0 ? (
                            <p className="text-muted text-center" style={{ padding: '2rem' }}>
                                ยังไม่มีหมวดคะแนน กด "+ สร้างหมวด" เพื่อเริ่มต้น
                            </p>
                        ) : (
                            <div className="flex flex-col gap-sm">
                                {categories.map(cat => (
                                    <div
                                        key={cat.id}
                                        className="flex items-center justify-between"
                                        style={{
                                            padding: 'var(--space-md)',
                                            background: 'var(--bg-glass)',
                                            borderRadius: 'var(--radius-md)'
                                        }}
                                    >
                                        <div>
                                            <span style={{ fontWeight: 500 }}>{cat.name}</span>
                                            <span className="text-muted" style={{ marginLeft: '0.5rem' }}>
                                                ({cat.maxScore} คะแนน)
                                            </span>
                                        </div>
                                        <div className="flex gap-sm items-center">
                                            <button
                                                className={`btn ${cat.isPublished ? 'btn-success' : 'btn-secondary'}`}
                                                onClick={() => handleTogglePublish(cat)}
                                                style={{ fontSize: '0.85rem', padding: '0.3rem 0.6rem' }}
                                            >
                                                {cat.isPublished ? '✓ เผยแพร่แล้ว' : 'ยังไม่เผยแพร่'}
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => {
                                                    setEditingCategory(cat);
                                                    setCategoryName(cat.name);
                                                    setCategoryMaxScore(cat.maxScore?.toString() || '');
                                                    setShowCategoryModal(true);
                                                }}
                                                style={{ fontSize: '0.85rem', padding: '0.3rem 0.6rem' }}
                                            >
                                                แก้ไข
                                            </button>
                                            <button
                                                className="btn btn-danger"
                                                onClick={() => handleDeleteCategory(cat)}
                                                style={{ fontSize: '0.85rem', padding: '0.3rem 0.6rem' }}
                                            >
                                                ลบ
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Import Section */}
                    {categories.length > 0 && (
                        <div className="card mb-lg">
                            <div className="card-header">
                                <h3 className="card-title">Import คะแนน</h3>
                            </div>

                            <div className="flex gap-md mb-md">
                                <select
                                    className="form-input form-select"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    style={{ flex: 1 }}
                                >
                                    <option value="">-- เลือกหมวด --</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>
                                            {cat.name} ({cat.maxScore})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    Paste จาก Google Sheets (รหัสนิสิต TAB คะแนน)
                                </label>
                                <textarea
                                    className="form-input"
                                    rows={6}
                                    placeholder="64000001	8
64000002	9
64000003	7"
                                    value={pasteData}
                                    onChange={(e) => setPasteData(e.target.value)}
                                />
                            </div>

                            <div className="flex gap-md">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handlePreview}
                                    disabled={!pasteData.trim() || !selectedCategory}
                                >
                                    👁️ Preview
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleImport}
                                    disabled={previewData.length === 0 || importing}
                                >
                                    {importing ? 'กำลังบันทึก...' : '💾 บันทึก'}
                                </button>
                            </div>

                            {/* Preview Table */}
                            {showPreview && previewData.length > 0 && (
                                <div style={{ marginTop: 'var(--space-lg)' }}>
                                    <h4 style={{ marginBottom: 'var(--space-sm)' }}>
                                        Preview ({previewData.length} รายการ)
                                    </h4>
                                    <div style={{
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                        background: 'var(--bg-glass)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: 'var(--space-sm)'
                                    }}>
                                        <table className="table">
                                            <thead>
                                                <tr>
                                                    <th>รหัส</th>
                                                    <th>ชื่อ</th>
                                                    <th>คะแนน</th>
                                                    <th>สถานะ</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {previewData.map((row, idx) => (
                                                    <tr key={idx}>
                                                        <td>{row.studentId}</td>
                                                        <td>{row.studentName || '-'}</td>
                                                        <td>{row.score}</td>
                                                        <td>
                                                            {row.found ? (
                                                                <span style={{ color: 'var(--success)' }}>✓ พบในระบบ</span>
                                                            ) : (
                                                                <span style={{ color: 'var(--warning)' }}>⚠ ไม่พบ</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Grades Table */}
                    {categories.length > 0 && students.length > 0 && (
                        <div className="card">
                            <div className="card-header">
                                <h3 className="card-title">ตารางคะแนนรวม</h3>
                                <button className="btn btn-secondary" onClick={exportGradesCSV}>
                                    📤 Export CSV
                                </button>
                            </div>

                            <div style={{ overflowX: 'auto' }}>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>รหัส</th>
                                            <th>ชื่อ</th>
                                            {categories.map(cat => (
                                                <th key={cat.id} style={{ textAlign: 'center' }}>
                                                    {cat.name}
                                                    <br />
                                                    <small className="text-muted">({cat.maxScore})</small>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {students.map(student => (
                                            <tr key={student.id}>
                                                <td>{student.studentId}</td>
                                                <td>{student.name}</td>
                                                {categories.map(cat => {
                                                    const isEditing = editingCell?.studentId === student.studentId && editingCell?.categoryId === cat.id;
                                                    const value = getGradeValue(student.studentId, cat.id);

                                                    return (
                                                        <td
                                                            key={cat.id}
                                                            style={{
                                                                textAlign: 'center',
                                                                cursor: 'pointer',
                                                                padding: '0.25rem'
                                                            }}
                                                            onClick={() => !isEditing && handleCellClick(student.studentId, cat.id, value)}
                                                        >
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editValue}
                                                                    onChange={(e) => setEditValue(e.target.value)}
                                                                    onBlur={handleCellBlur}
                                                                    onKeyDown={handleCellKeyDown}
                                                                    autoFocus
                                                                    style={{
                                                                        width: '60px',
                                                                        textAlign: 'center',
                                                                        padding: '0.25rem',
                                                                        border: '2px solid var(--primary)',
                                                                        borderRadius: 'var(--radius-sm)',
                                                                        fontSize: 'inherit'
                                                                    }}
                                                                    step="0.5"
                                                                    min="0"
                                                                />
                                                            ) : (
                                                                <span
                                                                    style={{
                                                                        display: 'inline-block',
                                                                        minWidth: '40px',
                                                                        padding: '0.25rem 0.5rem',
                                                                        borderRadius: 'var(--radius-sm)',
                                                                        background: value === '-' ? 'transparent' : 'rgba(99, 102, 241, 0.1)'
                                                                    }}
                                                                    title="คลิกเพื่อแก้ไข"
                                                                >
                                                                    {value}
                                                                </span>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Category Modal */}
            {showCategoryModal && (
                <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingCategory ? 'แก้ไขหมวด' : 'สร้างหมวดคะแนน'}
                            </h2>
                            <button className="modal-close" onClick={() => setShowCategoryModal(false)}>×</button>
                        </div>
                        <div style={{ padding: 'var(--space-lg)' }}>
                            <div className="form-group">
                                <label className="form-label">ชื่อหมวด</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={categoryName}
                                    onChange={(e) => setCategoryName(e.target.value)}
                                    placeholder="เช่น Quiz 1, Midterm, Project"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">คะแนนเต็ม</label>
                                <input
                                    type="number"
                                    className="form-input"
                                    value={categoryMaxScore}
                                    onChange={(e) => setCategoryMaxScore(e.target.value)}
                                    placeholder="10"
                                />
                            </div>
                            <div className="flex gap-md justify-center">
                                <button className="btn btn-secondary" onClick={() => setShowCategoryModal(false)}>
                                    ยกเลิก
                                </button>
                                <button className="btn btn-primary" onClick={handleSaveCategory}>
                                    {editingCategory ? 'บันทึก' : 'สร้าง'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
