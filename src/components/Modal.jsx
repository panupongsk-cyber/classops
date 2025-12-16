import { useState, useEffect } from 'react';

export default function Modal({ isOpen, onClose, title, children, footer }) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">{title}</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    {children}
                </div>
                {footer && (
                    <div className="modal-footer">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

// Classroom Form Modal
export function ClassroomModal({ isOpen, onClose, onSubmit, classroom = null, teachers = [] }) {
    const [name, setName] = useState(classroom?.name || '');
    const [code, setCode] = useState(classroom?.code || '');
    const [qrInterval, setQrInterval] = useState(classroom?.qrInterval || 30);
    const [selectedTeachers, setSelectedTeachers] = useState(classroom?.teacherEmails || []);
    const [loading, setLoading] = useState(false);

    // Update form when classroom prop changes (for edit mode)
    useEffect(() => {
        if (classroom) {
            setName(classroom.name || '');
            setCode(classroom.code || '');
            setQrInterval(classroom.qrInterval || 30);
            setSelectedTeachers(classroom.teacherEmails || []);
        } else {
            setName('');
            setCode('');
            setQrInterval(30);
            setSelectedTeachers([]);
        }
    }, [classroom]);

    const toggleTeacher = (email) => {
        setSelectedTeachers(prev =>
            prev.includes(email)
                ? prev.filter(e => e !== email)
                : [...prev, email]
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSubmit({
                name,
                code,
                qrInterval: Number(qrInterval),
                teacherEmails: selectedTeachers
            });
            onClose();
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={classroom ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชาใหม่'}
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        ยกเลิก
                    </button>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
                        {loading ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                </>
            }
        >
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label className="form-label">ชื่อรายวิชา</label>
                    <input
                        type="text"
                        className="form-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="เช่น Programming 101"
                        required
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">รหัสวิชา (ไม่บังคับ)</label>
                    <input
                        type="text"
                        className="form-input"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="เช่น CS101"
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">QR Refresh Interval (วินาที)</label>
                    <input
                        type="number"
                        className="form-input"
                        value={qrInterval}
                        onChange={(e) => setQrInterval(e.target.value)}
                        min="10"
                        max="300"
                        required
                    />
                    <small className="text-muted">QR Code และรหัส emoji จะเปลี่ยนทุก ๆ กี่วินาที (10-300)</small>
                </div>

                {/* Teacher selection */}
                {teachers.length > 0 && (
                    <div className="form-group">
                        <label className="form-label">อาจารย์ผู้รับผิดชอบ</label>
                        <div style={{
                            maxHeight: '150px',
                            overflowY: 'auto',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--space-sm)'
                        }}>
                            {teachers.map(teacher => (
                                <label
                                    key={teacher.email}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-sm)',
                                        padding: 'var(--space-xs) var(--space-sm)',
                                        cursor: 'pointer',
                                        borderRadius: 'var(--radius-sm)',
                                        background: selectedTeachers.includes(teacher.email)
                                            ? 'rgba(99, 102, 241, 0.1)'
                                            : 'transparent'
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTeachers.includes(teacher.email)}
                                        onChange={() => toggleTeacher(teacher.email)}
                                        style={{ width: '18px', height: '18px' }}
                                    />
                                    <span>
                                        {teacher.name}
                                        <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                                            ({teacher.email})
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <small className="text-muted">เลือกอาจารย์ที่สามารถจัดการรายวิชานี้ได้</small>
                    </div>
                )}
            </form>
        </Modal>
    );
}

// Student Form Modal
export function StudentModal({ isOpen, onClose, onSubmit, student = null }) {
    const [name, setName] = useState(student?.name || '');
    const [email, setEmail] = useState(student?.email || '');
    const [studentId, setStudentId] = useState(student?.studentId || '');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSubmit({ name, email, studentId });
            onClose();
            // Reset form
            setName('');
            setEmail('');
            setStudentId('');
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={student ? 'แก้ไขข้อมูลนักศึกษา' : 'เพิ่มนักศึกษาใหม่'}
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        ยกเลิก
                    </button>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
                        {loading ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                </>
            }
        >
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label className="form-label">ชื่อ-นามสกุล</label>
                    <input
                        type="text"
                        className="form-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="สมชาย ใจดี"
                        required
                    />
                </div>
                <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                        type="email"
                        className="form-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="student@example.com"
                        required
                    />
                    <small className="text-muted">ใช้สำหรับ login และระบุตัวตนเมื่อ scan QR</small>
                </div>
                <div className="form-group">
                    <label className="form-label">รหัสนักศึกษา</label>
                    <input
                        type="text"
                        className="form-input"
                        value={studentId}
                        onChange={(e) => setStudentId(e.target.value)}
                        placeholder="6401234567"
                        required
                    />
                </div>
            </form>
        </Modal>
    );
}

// Confirm Modal
export function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmText = 'ยืนยัน', danger = false }) {
    const [loading, setLoading] = useState(false);

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await onConfirm();
            onClose();
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        ยกเลิก
                    </button>
                    <button
                        className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={handleConfirm}
                        disabled={loading}
                    >
                        {loading ? 'กำลังดำเนินการ...' : confirmText}
                    </button>
                </>
            }
        >
            <p>{message}</p>
        </Modal>
    );
}
