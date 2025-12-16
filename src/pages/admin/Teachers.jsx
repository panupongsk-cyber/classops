import { useState, useEffect } from 'react';
import {
    getAllowedTeachers,
    addAllowedTeacher,
    removeAllowedTeacher,
    updateUserRole
} from '../../firebase/firestore';
import Modal, { ConfirmModal } from '../../components/Modal';

const PlusIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

// Add Teacher Modal with optimistic update
function AddTeacherModal({ isOpen, onClose, onSubmit }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async () => {
        if (!name.trim() || !email.trim()) {
            setError('กรุณากรอกข้อมูลให้ครบ');
            return;
        }

        // Close modal immediately (optimistic)
        const teacherData = { name: name.trim(), email: email.trim() };
        setName('');
        setEmail('');
        setError('');
        onClose();

        // Fire and forget - don't wait
        onSubmit(teacherData);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="เพิ่มอาจารย์"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        ยกเลิก
                    </button>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
                        เพิ่มอาจารย์
                    </button>
                </>
            }
        >
            {error && (
                <div style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-md)',
                    marginBottom: 'var(--space-md)',
                    color: 'var(--error)'
                }}>
                    {error}
                </div>
            )}
            <div className="form-group">
                <label className="form-label" htmlFor="teacher-name">ชื่อ-นามสกุล</label>
                <input
                    id="teacher-name"
                    name="name"
                    type="text"
                    className="form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ดร.สมชาย ใจดี"
                />
            </div>
            <div className="form-group">
                <label className="form-label" htmlFor="teacher-email">Email</label>
                <input
                    id="teacher-email"
                    name="email"
                    type="email"
                    className="form-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teacher@university.ac.th"
                />
                <small className="text-muted">อาจารย์จะใช้ email นี้ในการ login ด้วย Google</small>
            </div>
        </Modal>
    );
}

export default function AdminTeachers() {
    const [teachers, setTeachers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedTeacher, setSelectedTeacher] = useState(null);
    const [status, setStatus] = useState('');

    useEffect(() => {
        loadTeachers();
    }, []);

    const loadTeachers = () => {
        console.log('📚 Loading teachers...');
        getAllowedTeachers()
            .then(data => {
                console.log('📚 Teachers loaded:', data.length);
                setTeachers(data);
                setLoading(false);
            })
            .catch(error => {
                console.error('Failed to load teachers:', error);
                setLoading(false);
            });
    };

    const handleAdd = (data) => {
        console.log('➕ Adding teacher:', data);

        // Optimistic update - add to list immediately
        const newTeacher = {
            id: data.email.toLowerCase(),
            email: data.email.toLowerCase(),
            name: data.name,
            pending: true
        };
        setTeachers(prev => [...prev, newTeacher]);
        setStatus('กำลังบันทึก...');

        // Fire and forget
        addAllowedTeacher(data.email, data.name)
            .then(() => {
                console.log('✅ Teacher added to Firestore');
                setStatus('บันทึกสำเร็จ!');
                // Update to remove pending flag
                setTeachers(prev => prev.map(t =>
                    t.id === newTeacher.id ? { ...t, pending: false } : t
                ));
                setTimeout(() => setStatus(''), 2000);
            })
            .catch(err => {
                console.error('❌ Failed to add teacher:', err);
                setStatus('เกิดข้อผิดพลาด: ' + err.message);
                // Remove optimistic entry on failure
                setTeachers(prev => prev.filter(t => t.id !== newTeacher.id));
            });
    };

    const handleDelete = () => {
        if (!selectedTeacher) return;
        console.log('🗑️ Deleting teacher:', selectedTeacher.email);

        // Optimistic delete
        const deletedEmail = selectedTeacher.email;
        setTeachers(prev => prev.filter(t => t.email !== deletedEmail));
        setShowDeleteModal(false);
        setSelectedTeacher(null);
        setStatus('กำลังลบ...');

        // Fire and forget
        removeAllowedTeacher(deletedEmail)
            .then(() => {
                console.log('✅ Teacher deleted from Firestore');
                setStatus('ลบสำเร็จ!');
                setTimeout(() => setStatus(''), 2000);
            })
            .catch(err => {
                console.error('❌ Failed to delete teacher:', err);
                setStatus('เกิดข้อผิดพลาด');
                // Reload on failure
                loadTeachers();
            });
    };

    return (
        <div className="page container">
            <div className="flex justify-between items-center mb-lg">
                <div>
                    <h1 style={{ marginBottom: '0.25rem' }}>จัดการผู้ใช้งาน</h1>
                    <p className="text-muted">เพิ่มหรือลบอาจารย์/admin ที่สามารถเข้าใช้งานระบบ</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                    <PlusIcon />
                    เพิ่มอาจารย์
                </button>
            </div>

            {/* Status message */}
            {status && (
                <div style={{
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-md)',
                    marginBottom: 'var(--space-lg)',
                    color: 'var(--primary)'
                }}>
                    {status}
                </div>
            )}

            <div className="card">
                {loading ? (
                    <div className="text-center" style={{ padding: '2rem', color: 'var(--text-muted)' }}>
                        กำลังโหลดรายชื่ออาจารย์...
                    </div>
                ) : teachers.length === 0 ? (
                    <div className="empty-state">
                        <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <p>ยังไม่มีอาจารย์ในระบบ</p>
                        <button className="btn btn-primary mt-md" onClick={() => setShowAddModal(true)}>
                            เพิ่มอาจารย์คนแรก
                        </button>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>ชื่อ</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th style={{ width: '80px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {teachers.map((teacher) => (
                                    <tr key={teacher.id} style={{ opacity: teacher.pending ? 0.6 : 1 }}>
                                        <td>
                                            {teacher.name}
                                            {teacher.pending && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>(กำลังบันทึก)</span>}
                                        </td>
                                        <td>{teacher.email}</td>
                                        <td>
                                            <select
                                                className="form-input"
                                                value={teacher.role || 'teacher'}
                                                onChange={(e) => {
                                                    const newRole = e.target.value;
                                                    // Optimistic update
                                                    setTeachers(prev => prev.map(t =>
                                                        t.id === teacher.id ? { ...t, role: newRole } : t
                                                    ));
                                                    setStatus('กำลังบันทึก...');
                                                    updateUserRole(teacher.email, newRole)
                                                        .then(() => {
                                                            setStatus('เปลี่ยน role สำเร็จ!');
                                                            setTimeout(() => setStatus(''), 2000);
                                                        })
                                                        .catch(err => {
                                                            setStatus('เกิดข้อผิดพลาด');
                                                            loadTeachers();
                                                        });
                                                }}
                                                style={{
                                                    padding: '0.25rem 0.5rem',
                                                    fontSize: '0.85rem',
                                                    minWidth: '100px'
                                                }}
                                                disabled={teacher.pending}
                                            >
                                                <option value="teacher">Teacher</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        </td>
                                        <td>
                                            <button
                                                className="btn btn-danger btn-sm"
                                                disabled={teacher.pending}
                                                onClick={() => {
                                                    setSelectedTeacher(teacher);
                                                    setShowDeleteModal(true);
                                                }}
                                            >
                                                <TrashIcon />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Modal */}
            <AddTeacherModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSubmit={handleAdd}
            />

            {/* Delete Confirmation */}
            <ConfirmModal
                isOpen={showDeleteModal}
                onClose={() => {
                    setShowDeleteModal(false);
                    setSelectedTeacher(null);
                }}
                onConfirm={handleDelete}
                title="ลบอาจารย์"
                message={`ต้องการลบ ${selectedTeacher?.name} (${selectedTeacher?.email}) ออกจากระบบหรือไม่?`}
                confirmText="ลบ"
                danger={true}
            />
        </div>
    );
}
