import { useState, useEffect } from 'react';
import Modal from './Modal';

export default function ManualCheckInModal({
    isOpen,
    onClose,
    students = [],
    attendance = [],
    onCheckIn,
    onRecordLeave
}) {
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [leaveReason, setLeaveReason] = useState('');
    const [mode, setMode] = useState('checkin'); // 'checkin' or 'leave'
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('name'); // 'name' or 'studentId'

    // Reset form when modal opens/closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedStudent(null);
            setLeaveReason('');
            setMode('checkin');
            setSearchTerm('');
        }
    }, [isOpen]);

    // Filter out already checked-in students
    const checkedEmails = attendance.map(a => a.studentEmail?.toLowerCase());
    const availableStudents = students.filter(s =>
        !checkedEmails.includes(s.email?.toLowerCase())
    );

    // Apply search filter
    const filteredStudents = availableStudents.filter(s => {
        if (!searchTerm.trim()) return true;
        const search = searchTerm.toLowerCase();
        return (
            s.name?.toLowerCase().includes(search) ||
            s.studentId?.toLowerCase().includes(search) ||
            s.email?.toLowerCase().includes(search)
        );
    });

    // Sort filtered students
    const sortedFilteredStudents = [...filteredStudents].sort((a, b) => {
        if (sortBy === 'name') {
            return (a.name || '').localeCompare(b.name || '', 'th');
        } else {
            return (a.studentId || '').localeCompare(b.studentId || '');
        }
    });

    const handleSubmit = async () => {
        if (!selectedStudent) {
            alert('กรุณาเลือกนิสิต');
            return;
        }

        setLoading(true);
        try {
            if (mode === 'checkin') {
                await onCheckIn(selectedStudent);
            } else {
                await onRecordLeave(selectedStudent, leaveReason);
            }
            onClose();
        } catch (error) {
            alert(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="➕ เช็คชื่อ / บันทึกลา"
            footer={
                <>
                    <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        ยกเลิก
                    </button>
                    <button
                        className={`btn ${mode === 'leave' ? 'btn-warning' : 'btn-primary'}`}
                        onClick={handleSubmit}
                        disabled={loading || !selectedStudent}
                    >
                        {loading ? 'กำลังบันทึก...' : (mode === 'checkin' ? '✓ เช็คชื่อ' : '📝 บันทึกลา')}
                    </button>
                </>
            }
        >
            {/* Mode Toggle */}
            <div style={{
                display: 'flex',
                gap: 'var(--space-sm)',
                marginBottom: 'var(--space-lg)'
            }}>
                <button
                    className={`btn ${mode === 'checkin' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setMode('checkin')}
                    style={{ flex: 1 }}
                >
                    ✓ เช็คชื่อ
                </button>
                <button
                    className={`btn ${mode === 'leave' ? 'btn-warning' : 'btn-secondary'}`}
                    onClick={() => setMode('leave')}
                    style={{ flex: 1 }}
                >
                    📝 ลา
                </button>
            </div>

            {/* Search */}
            <div className="form-group">
                <div className="flex justify-between items-center mb-sm">
                    <label className="form-label" style={{ marginBottom: 0 }}>ค้นหานิสิต</label>
                    <div className="flex gap-sm items-center">
                        <label style={{ fontSize: '0.85rem' }}>เรียงตาม:</label>
                        <select
                            className="form-input form-select"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{ width: 'auto', minWidth: '100px', padding: '0.3rem 0.5rem' }}
                        >
                            <option value="name">ชื่อ</option>
                            <option value="studentId">รหัสนิสิต</option>
                        </select>
                    </div>
                </div>
                <input
                    type="text"
                    className="form-input"
                    placeholder="ชื่อ / รหัสนิสิต / email"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Student List */}
            <div className="form-group">
                <label className="form-label">
                    เลือกนิสิต ({filteredStudents.length} คน)
                </label>
                <div style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    {filteredStudents.length === 0 ? (
                        <div style={{ padding: 'var(--space-md)', textAlign: 'center', opacity: 0.6 }}>
                            {students.length === 0
                                ? 'ไม่มีนิสิตในรายวิชานี้'
                                : availableStudents.length === 0
                                    ? 'นิสิตทุกคนได้เช็คชื่อแล้ว'
                                    : 'ไม่พบนิสิตที่ค้นหา'
                            }
                        </div>
                    ) : (
                        sortedFilteredStudents.map((student) => (
                            <div
                                key={student.id}
                                onClick={() => setSelectedStudent(student)}
                                style={{
                                    padding: 'var(--space-sm) var(--space-md)',
                                    cursor: 'pointer',
                                    background: selectedStudent?.id === student.id
                                        ? 'var(--primary)'
                                        : 'transparent',
                                    borderBottom: '1px solid var(--border-color)',
                                    transition: 'background 0.2s'
                                }}
                            >
                                <div style={{ fontWeight: 500 }}>{student.name}</div>
                                <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                                    {student.studentId} • {student.email}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Leave Reason (only for leave mode) */}
            {mode === 'leave' && (
                <div className="form-group">
                    <label className="form-label">เหตุผลการลา</label>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="เช่น ป่วย, ติดธุระ, ฯลฯ"
                        value={leaveReason}
                        onChange={(e) => setLeaveReason(e.target.value)}
                    />
                </div>
            )}

            {/* Selected Student Preview */}
            {selectedStudent && (
                <div style={{
                    padding: 'var(--space-md)',
                    background: mode === 'leave' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(99, 102, 241, 0.1)',
                    borderRadius: 'var(--radius-md)',
                    marginTop: 'var(--space-md)'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                        {mode === 'checkin' ? '✓ จะเช็คชื่อให้:' : '📝 จะบันทึกลาให้:'}
                    </div>
                    <div>{selectedStudent.name} ({selectedStudent.studentId})</div>
                </div>
            )}
        </Modal>
    );
}
