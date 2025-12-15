import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getClassrooms, getAllClassrooms, getStudents, addStudent, updateStudent, deleteStudent } from '../../firebase/firestore';
import { StudentModal, ConfirmModal } from '../../components/Modal';
import CSVImport from '../../components/CSVImport';

const PlusIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" x2="12" y1="5" y2="19" />
        <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
);

const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
);

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
);

const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
);

export default function Students() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [selectedClassroom, setSelectedClassroom] = useState(null);
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showCSVModal, setShowCSVModal] = useState(false);
    const [editingStudent, setEditingStudent] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Load classrooms
    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                // Admin sees all classrooms, teacher sees only their own
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid);
                setClassrooms(data);
                if (data.length > 0) {
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

    // Load students for selected classroom
    useEffect(() => {
        const loadStudents = async () => {
            if (!selectedClassroom?.id) {
                setStudents([]);
                return;
            }
            try {
                const data = await getStudents(selectedClassroom.id);
                setStudents(data);
            } catch (error) {
                console.error('Failed to load students:', error);
            }
        };
        loadStudents();
    }, [selectedClassroom?.id]);

    const handleAdd = async (data) => {
        const id = await addStudent(selectedClassroom.id, data);
        setStudents(prev => [...prev, { id, ...data }].sort((a, b) => a.name.localeCompare(b.name)));
    };

    const handleEdit = async (data) => {
        await updateStudent(editingStudent.id, data);
        setStudents(prev =>
            prev.map(s => s.id === editingStudent.id ? { ...s, ...data } : s)
        );
        setEditingStudent(null);
    };

    const handleDelete = async () => {
        await deleteStudent(deleteTarget.id);
        setStudents(prev => prev.filter(s => s.id !== deleteTarget.id));
        setDeleteTarget(null);
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
                    <p className="text-muted mb-lg">สร้างรายวิชาก่อนเพิ่มนักศึกษา</p>
                    <a href="/teacher/classrooms" className="btn btn-primary">
                        สร้างรายวิชา
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="page container">
            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                <div className="flex justify-between items-center mb-lg">
                    <div>
                        <h1>นักศึกษา</h1>
                        <p className="text-muted">ลงทะเบียนนักศึกษาในรายวิชา</p>
                    </div>
                    <div className="flex gap-md">
                        <select
                            className="form-input form-select"
                            value={selectedClassroom?.id || ''}
                            onChange={(e) => {
                                const classroom = classrooms.find(c => c.id === e.target.value);
                                setSelectedClassroom(classroom);
                            }}
                            style={{ width: 'auto', minWidth: '200px' }}
                        >
                            {classrooms.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        <button className="btn btn-secondary" onClick={() => setShowCSVModal(true)}>
                            <UploadIcon />
                            นำเข้า CSV
                        </button>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <PlusIcon />
                            เพิ่มนักศึกษา
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 'var(--space-lg)' }}>
                    <div className="stat-card">
                        <div className="stat-value">{students.length}</div>
                        <div className="stat-label">นักศึกษาทั้งหมด</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{selectedClassroom?.name || '-'}</div>
                        <div className="stat-label">รายวิชา</div>
                    </div>
                </div>

                {/* Student List */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">รายชื่อนักศึกษา</h3>
                    </div>

                    {students.length === 0 ? (
                        <div className="empty-state">
                            <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                            </svg>
                            <p>ยังไม่มีนักศึกษาในรายวิชานี้</p>
                            <button className="btn btn-primary mt-md" onClick={() => setShowModal(true)}>
                                <PlusIcon />
                                เพิ่มนักศึกษา
                            </button>
                        </div>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>ชื่อ-นามสกุล</th>
                                    <th>รหัสนักศึกษา</th>
                                    <th>Email</th>
                                    <th style={{ width: '100px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.map((student) => (
                                    <tr key={student.id}>
                                        <td style={{ fontWeight: 500 }}>{student.name}</td>
                                        <td>{student.studentId}</td>
                                        <td className="text-muted">{student.email}</td>
                                        <td>
                                            <div className="flex gap-sm justify-end">
                                                <button
                                                    className="btn btn-secondary btn-icon"
                                                    onClick={() => {
                                                        setEditingStudent(student);
                                                        setShowModal(true);
                                                    }}
                                                    title="แก้ไข"
                                                >
                                                    <EditIcon />
                                                </button>
                                                <button
                                                    className="btn btn-secondary btn-icon"
                                                    onClick={() => setDeleteTarget(student)}
                                                    title="ลบ"
                                                    style={{ color: 'var(--error)' }}
                                                >
                                                    <TrashIcon />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Add/Edit Modal */}
                <StudentModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setEditingStudent(null);
                    }}
                    onSubmit={editingStudent ? handleEdit : handleAdd}
                    student={editingStudent}
                />

                {/* Delete Confirmation */}
                <ConfirmModal
                    isOpen={!!deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={handleDelete}
                    title="ลบนักศึกษา"
                    message={`คุณต้องการลบ "${deleteTarget?.name}" ออกจากรายวิชานี้หรือไม่?`}
                    confirmText="ลบนักศึกษา"
                    danger
                />

                {/* CSV Import Modal */}
                <CSVImport
                    isOpen={showCSVModal}
                    onClose={() => setShowCSVModal(false)}
                    onImport={handleAdd}
                />
            </div>
        </div>
    );
}
