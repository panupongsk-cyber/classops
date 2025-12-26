import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getClassrooms,
    getAllClassrooms,
    getStudents,
    getGroupSets,
    createGroupSet,
    updateGroupSet,
    deleteGroupSet,
    getStudentGroups,
    createStudentGroup,
    updateStudentGroup,
    deleteStudentGroup,
    addStudentsToGroup,
    removeStudentFromGroup
} from '../../firebase/firestore';

// Icons
const PlusIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" x2="12" y1="5" y2="19" />
        <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
);

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
);

const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
);

const UsersIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const XIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
    </svg>
);

// Color palette for groups
const GROUP_COLORS = [
    '#6366F1', // Indigo
    '#EC4899', // Pink
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#3B82F6', // Blue
    '#8B5CF6', // Violet
    '#EF4444', // Red
    '#14B8A6', // Teal
];

export default function GroupsPage() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [students, setStudents] = useState([]);
    const [groupSets, setGroupSets] = useState([]);
    const [selectedSet, setSelectedSet] = useState(null);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingGroups, setLoadingGroups] = useState(false);

    // Modal states
    const [showSetModal, setShowSetModal] = useState(false);
    const [editingSet, setEditingSet] = useState(null);
    const [setName, setSetName] = useState('');
    const [setDescription, setSetDescription] = useState('');

    const [showGroupModal, setShowGroupModal] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [groupName, setGroupName] = useState('');
    const [groupColor, setGroupColor] = useState(GROUP_COLORS[0]);

    const [showAddStudentsModal, setShowAddStudentsModal] = useState(false);
    const [targetGroup, setTargetGroup] = useState(null);
    const [selectedStudents, setSelectedStudents] = useState([]);

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

    // Load students and group sets when classroom changes
    useEffect(() => {
        const loadData = async () => {
            if (!selectedClassroom?.id) return;

            try {
                const [studentsData, setsData] = await Promise.all([
                    getStudents(selectedClassroom.id),
                    getGroupSets(selectedClassroom.id)
                ]);
                setStudents(studentsData);
                setGroupSets(setsData);

                // Auto-select first set
                if (setsData.length > 0) {
                    setSelectedSet(setsData[0]);
                } else {
                    setSelectedSet(null);
                    setGroups([]);
                }
            } catch (error) {
                console.error('Failed to load data:', error);
            }
        };
        loadData();
    }, [selectedClassroom?.id]);

    // Load groups when set changes
    useEffect(() => {
        const loadGroups = async () => {
            if (!selectedSet?.id) {
                setGroups([]);
                return;
            }

            setLoadingGroups(true);
            try {
                const data = await getStudentGroups(selectedSet.id);
                setGroups(data);
            } catch (error) {
                console.error('Failed to load groups:', error);
            } finally {
                setLoadingGroups(false);
            }
        };
        loadGroups();
    }, [selectedSet?.id]);

    // Get students not in any group (for current set)
    const getUnassignedStudents = () => {
        const assignedIds = new Set();
        groups.forEach(g => {
            (g.studentIds || []).forEach(id => assignedIds.add(id));
        });
        return students.filter(s => !assignedIds.has(s.studentId));
    };

    // Group Set handlers
    const handleSaveSet = async () => {
        if (!setName.trim()) return;

        try {
            if (editingSet) {
                await updateGroupSet(editingSet.id, {
                    name: setName,
                    description: setDescription
                });
            } else {
                await createGroupSet(selectedClassroom.id, setName, setDescription);
            }

            const updated = await getGroupSets(selectedClassroom.id);
            setGroupSets(updated);
            if (!selectedSet && updated.length > 0) {
                setSelectedSet(updated[0]);
            }

            setShowSetModal(false);
            setSetName('');
            setSetDescription('');
            setEditingSet(null);
        } catch (error) {
            console.error('Failed to save set:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    const handleDeleteSet = async (set) => {
        if (!confirm(`ลบรอบ "${set.name}" และกลุ่มทั้งหมดในรอบนี้?`)) return;

        try {
            await deleteGroupSet(set.id);
            const updated = await getGroupSets(selectedClassroom.id);
            setGroupSets(updated);

            if (selectedSet?.id === set.id) {
                setSelectedSet(updated.length > 0 ? updated[0] : null);
            }
        } catch (error) {
            console.error('Failed to delete set:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    // Group handlers
    const handleSaveGroup = async () => {
        if (!groupName.trim() || !selectedSet) return;

        try {
            if (editingGroup) {
                await updateStudentGroup(editingGroup.id, {
                    name: groupName,
                    color: groupColor
                });
            } else {
                await createStudentGroup(
                    selectedClassroom.id,
                    selectedSet.id,
                    groupName,
                    groupColor
                );
            }

            const updated = await getStudentGroups(selectedSet.id);
            setGroups(updated);

            setShowGroupModal(false);
            setGroupName('');
            setGroupColor(GROUP_COLORS[0]);
            setEditingGroup(null);
        } catch (error) {
            console.error('Failed to save group:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    const handleDeleteGroup = async (group) => {
        if (!confirm(`ลบกลุ่ม "${group.name}"?`)) return;

        try {
            await deleteStudentGroup(group.id);
            const updated = await getStudentGroups(selectedSet.id);
            setGroups(updated);
        } catch (error) {
            console.error('Failed to delete group:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    // Add students to group
    const handleOpenAddStudents = (group) => {
        setTargetGroup(group);
        setSelectedStudents([]);
        setShowAddStudentsModal(true);
    };

    const handleAddStudents = async () => {
        if (!targetGroup || selectedStudents.length === 0) return;

        try {
            const studentsToAdd = students.filter(s =>
                selectedStudents.includes(s.studentId)
            );
            await addStudentsToGroup(targetGroup.id, studentsToAdd);

            const updated = await getStudentGroups(selectedSet.id);
            setGroups(updated);

            setShowAddStudentsModal(false);
            setTargetGroup(null);
            setSelectedStudents([]);
        } catch (error) {
            console.error('Failed to add students:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    const handleRemoveStudent = async (group, studentId, studentEmail) => {
        if (!confirm('ลบนิสิตออกจากกลุ่มนี้?')) return;

        try {
            await removeStudentFromGroup(group.id, studentId, studentEmail);
            const updated = await getStudentGroups(selectedSet.id);
            setGroups(updated);
        } catch (error) {
            console.error('Failed to remove student:', error);
            alert('เกิดข้อผิดพลาด: ' + error.message);
        }
    };

    // Get student name by ID
    const getStudentName = (studentId) => {
        const student = students.find(s => s.studentId === studentId);
        return student?.name || studentId;
    };

    const getStudentEmail = (studentId) => {
        const student = students.find(s => s.studentId === studentId);
        return student?.email || '';
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
                <div className="card text-center" style={{ maxWidth: '500px', margin: '0 auto' }}>
                    <h2>ยังไม่มีรายวิชา</h2>
                    <p className="text-muted mb-lg">สร้างรายวิชาก่อนจัดกลุ่มนิสิต</p>
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
                    <h1 style={{ marginBottom: '0.25rem' }}>จัดกลุ่มนิสิต</h1>
                    <p className="text-muted">สร้างรอบและกลุ่มสำหรับมอบหมายงาน</p>
                </div>

                <select
                    className="form-input form-select"
                    value={selectedClassroom?.id || ''}
                    onChange={(e) => {
                        const classroom = classrooms.find(c => c.id === e.target.value);
                        setSelectedClassroom(classroom);
                        setSelectedSet(null);
                        setGroups([]);
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

            <div className="flex gap-lg" style={{ alignItems: 'flex-start' }}>
                {/* Sidebar - Group Sets */}
                <div className="card" style={{ width: '280px', flexShrink: 0 }}>
                    <div className="card-header">
                        <h3 className="card-title">รอบการจัดกลุ่ม</h3>
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                setEditingSet(null);
                                setSetName('');
                                setSetDescription('');
                                setShowSetModal(true);
                            }}
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                        >
                            <PlusIcon /> สร้างรอบ
                        </button>
                    </div>

                    {groupSets.length === 0 ? (
                        <div className="text-center text-muted" style={{ padding: '2rem 1rem' }}>
                            <p>ยังไม่มีรอบการจัดกลุ่ม</p>
                            <p style={{ fontSize: '0.85rem' }}>กด "สร้างรอบ" เพื่อเริ่มต้น</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-xs" style={{ padding: 'var(--space-sm)' }}>
                            {groupSets.map(set => (
                                <div
                                    key={set.id}
                                    className="flex items-center justify-between"
                                    style={{
                                        padding: '0.75rem 1rem',
                                        background: selectedSet?.id === set.id
                                            ? 'var(--primary)'
                                            : 'var(--bg-glass)',
                                        color: selectedSet?.id === set.id ? 'white' : 'inherit',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease'
                                    }}
                                    onClick={() => setSelectedSet(set)}
                                >
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{set.name}</div>
                                        {set.description && (
                                            <div style={{
                                                fontSize: '0.8rem',
                                                opacity: 0.7,
                                                marginTop: '0.2rem'
                                            }}>
                                                {set.description}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-xs">
                                        <button
                                            className="btn btn-icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingSet(set);
                                                setSetName(set.name);
                                                setSetDescription(set.description || '');
                                                setShowSetModal(true);
                                            }}
                                            style={{
                                                padding: '0.3rem',
                                                background: 'transparent',
                                                color: selectedSet?.id === set.id ? 'white' : 'var(--text-secondary)'
                                            }}
                                            title="แก้ไข"
                                        >
                                            <EditIcon />
                                        </button>
                                        <button
                                            className="btn btn-icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteSet(set);
                                            }}
                                            style={{
                                                padding: '0.3rem',
                                                background: 'transparent',
                                                color: selectedSet?.id === set.id ? 'white' : 'var(--error)'
                                            }}
                                            title="ลบ"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Main Content - Groups */}
                <div style={{ flex: 1 }}>
                    {!selectedSet ? (
                        <div className="card text-center" style={{ padding: '4rem 2rem' }}>
                            <UsersIcon />
                            <h3 style={{ marginTop: '1rem' }}>เลือกรอบการจัดกลุ่ม</h3>
                            <p className="text-muted">สร้างหรือเลือกรอบจาก sidebar ซ้าย</p>
                        </div>
                    ) : (
                        <>
                            {/* Groups Header */}
                            <div className="flex justify-between items-center mb-md">
                                <div>
                                    <h2 style={{ margin: 0 }}>{selectedSet.name}</h2>
                                    <p className="text-muted" style={{ margin: 0 }}>
                                        {groups.length} กลุ่ม | นิสิตยังไม่มีกลุ่ม: {getUnassignedStudents().length} คน
                                    </p>
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setEditingGroup(null);
                                        setGroupName('');
                                        setGroupColor(GROUP_COLORS[groups.length % GROUP_COLORS.length]);
                                        setShowGroupModal(true);
                                    }}
                                >
                                    <PlusIcon /> สร้างกลุ่ม
                                </button>
                            </div>

                            {loadingGroups ? (
                                <div className="text-center text-muted" style={{ padding: '2rem' }}>
                                    กำลังโหลด...
                                </div>
                            ) : groups.length === 0 ? (
                                <div className="card text-center" style={{ padding: '3rem' }}>
                                    <p className="text-muted">ยังไม่มีกลุ่มในรอบนี้</p>
                                    <button
                                        className="btn btn-primary mt-md"
                                        onClick={() => {
                                            setEditingGroup(null);
                                            setGroupName('');
                                            setGroupColor(GROUP_COLORS[0]);
                                            setShowGroupModal(true);
                                        }}
                                    >
                                        <PlusIcon /> สร้างกลุ่มแรก
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-md">
                                    {groups.map(group => (
                                        <div
                                            key={group.id}
                                            className="card"
                                            style={{
                                                borderLeft: `4px solid ${group.color || '#6366F1'}`
                                            }}
                                        >
                                            <div className="card-header">
                                                <div className="flex items-center gap-sm">
                                                    <div
                                                        style={{
                                                            width: '12px',
                                                            height: '12px',
                                                            borderRadius: '50%',
                                                            background: group.color || '#6366F1'
                                                        }}
                                                    />
                                                    <h3 className="card-title" style={{ margin: 0 }}>
                                                        {group.name}
                                                    </h3>
                                                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                                                        ({(group.studentIds || []).length} คน)
                                                    </span>
                                                </div>
                                                <div className="flex gap-sm">
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => handleOpenAddStudents(group)}
                                                        style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                                                    >
                                                        <PlusIcon /> เพิ่มนิสิต
                                                    </button>
                                                    <button
                                                        className="btn btn-secondary btn-icon"
                                                        onClick={() => {
                                                            setEditingGroup(group);
                                                            setGroupName(group.name);
                                                            setGroupColor(group.color || '#6366F1');
                                                            setShowGroupModal(true);
                                                        }}
                                                        title="แก้ไข"
                                                    >
                                                        <EditIcon />
                                                    </button>
                                                    <button
                                                        className="btn btn-secondary btn-icon"
                                                        onClick={() => handleDeleteGroup(group)}
                                                        style={{ color: 'var(--error)' }}
                                                        title="ลบกลุ่ม"
                                                    >
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </div>

                                            {(group.studentIds || []).length === 0 ? (
                                                <div className="text-center text-muted" style={{ padding: '1.5rem' }}>
                                                    ยังไม่มีสมาชิก
                                                </div>
                                            ) : (
                                                <div className="flex flex-wrap gap-sm" style={{ padding: 'var(--space-md)' }}>
                                                    {(group.studentIds || []).map(studentId => (
                                                        <div
                                                            key={studentId}
                                                            className="flex items-center gap-xs"
                                                            style={{
                                                                padding: '0.4rem 0.8rem',
                                                                background: 'var(--bg-glass)',
                                                                borderRadius: 'var(--radius-full)',
                                                                fontSize: '0.9rem'
                                                            }}
                                                        >
                                                            <span>{getStudentName(studentId)}</span>
                                                            <button
                                                                onClick={() => handleRemoveStudent(
                                                                    group,
                                                                    studentId,
                                                                    getStudentEmail(studentId)
                                                                )}
                                                                style={{
                                                                    background: 'none',
                                                                    border: 'none',
                                                                    padding: '0.2rem',
                                                                    cursor: 'pointer',
                                                                    color: 'var(--text-secondary)',
                                                                    display: 'flex',
                                                                    alignItems: 'center'
                                                                }}
                                                                title="ลบออกจากกลุ่ม"
                                                            >
                                                                <XIcon />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {/* Unassigned Students */}
                                    {getUnassignedStudents().length > 0 && (
                                        <div className="card" style={{ background: 'var(--bg-glass)', overflow: 'hidden' }}>
                                            <div className="card-header">
                                                <h3 className="card-title text-muted">
                                                    นิสิตที่ยังไม่มีกลุ่ม ({getUnassignedStudents().length})
                                                </h3>
                                            </div>
                                            <div style={{
                                                padding: 'var(--space-md)',
                                                maxHeight: '300px',
                                                overflowY: 'auto'
                                            }}>
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                                                    gap: 'var(--space-sm)'
                                                }}>
                                                    {getUnassignedStudents().map(student => (
                                                        <div
                                                            key={student.id}
                                                            style={{
                                                                padding: '0.4rem 0.8rem',
                                                                background: 'var(--bg-secondary)',
                                                                borderRadius: 'var(--radius-md)',
                                                                fontSize: '0.85rem',
                                                                textAlign: 'center',
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis'
                                                            }}
                                                            title={student.name}
                                                        >
                                                            {student.name}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Set Modal */}
            {showSetModal && (
                <div className="modal-overlay" onClick={() => setShowSetModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingSet ? 'แก้ไขรอบ' : 'สร้างรอบใหม่'}
                            </h2>
                            <button className="modal-close" onClick={() => setShowSetModal(false)}>×</button>
                        </div>
                        <div style={{ padding: 'var(--space-lg)' }}>
                            <div className="form-group">
                                <label className="form-label">ชื่อรอบ</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={setName}
                                    onChange={(e) => setSetName(e.target.value)}
                                    placeholder="เช่น Project 1, Lab Groups"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">คำอธิบาย (ไม่บังคับ)</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={setDescription}
                                    onChange={(e) => setSetDescription(e.target.value)}
                                    placeholder="รายละเอียดเพิ่มเติม"
                                />
                            </div>
                            <div className="flex gap-md justify-center">
                                <button className="btn btn-secondary" onClick={() => setShowSetModal(false)}>
                                    ยกเลิก
                                </button>
                                <button className="btn btn-primary" onClick={handleSaveSet}>
                                    {editingSet ? 'บันทึก' : 'สร้าง'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Group Modal */}
            {showGroupModal && (
                <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editingGroup ? 'แก้ไขกลุ่ม' : 'สร้างกลุ่มใหม่'}
                            </h2>
                            <button className="modal-close" onClick={() => setShowGroupModal(false)}>×</button>
                        </div>
                        <div style={{ padding: 'var(--space-lg)' }}>
                            <div className="form-group">
                                <label className="form-label">ชื่อกลุ่ม</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={groupName}
                                    onChange={(e) => setGroupName(e.target.value)}
                                    placeholder="เช่น กลุ่ม 1, Team A"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">สี</label>
                                <div className="flex gap-sm flex-wrap">
                                    {GROUP_COLORS.map(color => (
                                        <button
                                            key={color}
                                            onClick={() => setGroupColor(color)}
                                            style={{
                                                width: '36px',
                                                height: '36px',
                                                borderRadius: '50%',
                                                background: color,
                                                border: groupColor === color
                                                    ? '3px solid var(--text-primary)'
                                                    : '3px solid transparent',
                                                cursor: 'pointer',
                                                transition: 'transform 0.1s ease'
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-md justify-center">
                                <button className="btn btn-secondary" onClick={() => setShowGroupModal(false)}>
                                    ยกเลิก
                                </button>
                                <button className="btn btn-primary" onClick={handleSaveGroup}>
                                    {editingGroup ? 'บันทึก' : 'สร้าง'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Students Modal */}
            {showAddStudentsModal && targetGroup && (
                <div className="modal-overlay" onClick={() => setShowAddStudentsModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                เพิ่มนิสิตเข้า "{targetGroup.name}"
                            </h2>
                            <button className="modal-close" onClick={() => setShowAddStudentsModal(false)}>×</button>
                        </div>
                        <div style={{ padding: 'var(--space-lg)' }}>
                            <p className="text-muted mb-md">เลือกนิสิตที่ต้องการเพิ่มเข้ากลุ่ม:</p>

                            <div style={{
                                maxHeight: '300px',
                                overflowY: 'auto',
                                background: 'var(--bg-glass)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-sm)'
                            }}>
                                {getUnassignedStudents().length === 0 ? (
                                    <p className="text-center text-muted" style={{ padding: '1rem' }}>
                                        นิสิตทุกคนอยู่ในกลุ่มแล้ว
                                    </p>
                                ) : (
                                    getUnassignedStudents().map(student => (
                                        <label
                                            key={student.id}
                                            className="flex items-center gap-sm"
                                            style={{
                                                padding: '0.75rem 1rem',
                                                cursor: 'pointer',
                                                borderRadius: 'var(--radius-sm)',
                                                background: selectedStudents.includes(student.studentId)
                                                    ? 'rgba(99, 102, 241, 0.15)'
                                                    : 'transparent'
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedStudents.includes(student.studentId)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedStudents(prev => [...prev, student.studentId]);
                                                    } else {
                                                        setSelectedStudents(prev =>
                                                            prev.filter(id => id !== student.studentId)
                                                        );
                                                    }
                                                }}
                                                style={{ width: '18px', height: '18px' }}
                                            />
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{student.name}</div>
                                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                                    {student.studentId}
                                                </div>
                                            </div>
                                        </label>
                                    ))
                                )}
                            </div>

                            <div className="flex gap-md justify-center mt-lg">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowAddStudentsModal(false)}
                                >
                                    ยกเลิก
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAddStudents}
                                    disabled={selectedStudents.length === 0}
                                >
                                    เพิ่ม {selectedStudents.length} คน
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
