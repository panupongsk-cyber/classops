import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getClassrooms, getAllClassrooms, createClassroom, updateClassroom, deleteClassroom } from '../../firebase/firestore';
import { ClassroomModal, ConfirmModal } from '../../components/Modal';

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

export default function Classrooms() {
    const { user, userRole } = useAuth();
    const [classrooms, setClassrooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingClassroom, setEditingClassroom] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);

    useEffect(() => {
        const loadClassrooms = async () => {
            if (!user?.uid) return;
            try {
                // Admin sees all classrooms, teacher sees only their own
                const data = userRole === 'admin'
                    ? await getAllClassrooms()
                    : await getClassrooms(user.uid);
                setClassrooms(data);
            } catch (error) {
                console.error('Failed to load classrooms:', error);
            } finally {
                setLoading(false);
            }
        };
        loadClassrooms();
    }, [user?.uid, userRole]);

    const handleCreate = async (data) => {
        const id = await createClassroom(user.uid, user.email, data);
        setClassrooms(prev => [{ id, ...data, qrInterval: 30, teacherEmails: [user.email] }, ...prev]);
    };

    const handleEdit = async (data) => {
        await updateClassroom(editingClassroom.id, data);
        setClassrooms(prev =>
            prev.map(c => c.id === editingClassroom.id ? { ...c, ...data } : c)
        );
        setEditingClassroom(null);
    };

    const handleDelete = async () => {
        await deleteClassroom(deleteTarget.id);
        setClassrooms(prev => prev.filter(c => c.id !== deleteTarget.id));
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

    return (
        <div className="page container">
            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                <div className="flex justify-between items-center mb-lg">
                    <div>
                        <h1>รายวิชา</h1>
                        <p className="text-muted">จัดการรายวิชาที่คุณสอน</p>
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                        <PlusIcon />
                        เพิ่มรายวิชา
                    </button>
                </div>

                {classrooms.length === 0 ? (
                    <div className="card text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, margin: '0 auto 1rem' }}>
                            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                        </svg>
                        <h2>ยังไม่มีรายวิชา</h2>
                        <p className="text-muted mb-lg">สร้างรายวิชาแรกของคุณเพื่อเริ่มเช็คชื่อ</p>
                        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                            <PlusIcon />
                            สร้างรายวิชา
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-md">
                        {classrooms.map((classroom) => (
                            <div key={classroom.id} className="card" style={{ padding: 'var(--space-lg)' }}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 style={{ marginBottom: '0.25rem' }}>{classroom.name}</h3>
                                        <p className="text-muted" style={{ fontSize: '0.9rem' }}>
                                            {classroom.code && <span>รหัส: {classroom.code} • </span>}
                                            QR refresh: {classroom.qrInterval || 30} วินาที
                                        </p>
                                        {/* Show teachers */}
                                        {classroom.teacherEmails && classroom.teacherEmails.length > 0 && (
                                            <p style={{ fontSize: '0.85rem', marginTop: '0.25rem', color: 'var(--primary)' }}>
                                                👨‍🏫 {classroom.teacherEmails.join(', ')}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex gap-sm">
                                        <button
                                            className="btn btn-secondary btn-icon"
                                            onClick={() => {
                                                setEditingClassroom(classroom);
                                                setShowModal(true);
                                            }}
                                            title="แก้ไข"
                                        >
                                            <EditIcon />
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-icon"
                                            onClick={() => setDeleteTarget(classroom)}
                                            title="ลบ"
                                            style={{ color: 'var(--error)' }}
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Create/Edit Modal */}
                <ClassroomModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setEditingClassroom(null);
                    }}
                    onSubmit={editingClassroom ? handleEdit : handleCreate}
                    classroom={editingClassroom}
                />

                {/* Delete Confirmation */}
                <ConfirmModal
                    isOpen={!!deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={handleDelete}
                    title="ลบรายวิชา"
                    message={`คุณต้องการลบ "${deleteTarget?.name}" หรือไม่? ข้อมูลทั้งหมดจะถูกลบและไม่สามารถกู้คืนได้`}
                    confirmText="ลบรายวิชา"
                    danger
                />
            </div>
        </div>
    );
}
