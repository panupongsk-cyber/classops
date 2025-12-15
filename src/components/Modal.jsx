import { useState } from 'react';

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
export function ClassroomModal({ isOpen, onClose, onSubmit, classroom = null }) {
    const [name, setName] = useState(classroom?.name || '');
    const [code, setCode] = useState(classroom?.code || '');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSubmit({ name, code });
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
