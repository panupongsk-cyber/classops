import { useState, useEffect } from 'react';
import Modal from './Modal';

export default function SessionAttendanceModal({
    isOpen,
    onClose,
    session,
    classroom,
    students = [],
    attendance = [],
    onAddCheckIn,
    onAddLeave,
    onDeleteAttendance,
    onUpdateAttendance,
    refreshAttendance
}) {
    const [mode, setMode] = useState('view'); // 'view', 'add', 'edit'
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [selectedAttendance, setSelectedAttendance] = useState(null);
    const [leaveReason, setLeaveReason] = useState('');
    const [addMode, setAddMode] = useState('checkin'); // 'checkin' or 'leave'
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [sortBy, setSortBy] = useState('name'); // 'name' or 'studentId'

    // Reset form when modal opens/closes
    useEffect(() => {
        if (!isOpen) {
            setMode('view');
            setSelectedStudent(null);
            setSelectedAttendance(null);
            setLeaveReason('');
            setSearchTerm('');
            setAddMode('checkin');
        }
    }, [isOpen]);

    // Get students who haven't checked in yet
    const checkedEmails = attendance.map(a => a.studentEmail?.toLowerCase());
    const availableStudents = students.filter(s =>
        !checkedEmails.includes(s.email?.toLowerCase())
    );

    // Sort available students
    const sortedAvailableStudents = [...availableStudents].sort((a, b) => {
        if (sortBy === 'name') {
            return (a.name || '').localeCompare(b.name || '', 'th');
        } else {
            return (a.studentId || '').localeCompare(b.studentId || '');
        }
    });

    // Apply search filter
    const filteredStudents = sortedAvailableStudents.filter(s => {
        if (!searchTerm.trim()) return true;
        const search = searchTerm.toLowerCase();
        return (
            s.name?.toLowerCase().includes(search) ||
            s.studentId?.toLowerCase().includes(search) ||
            s.email?.toLowerCase().includes(search)
        );
    });

    // Sort attendance list
    const sortedAttendance = [...attendance].sort((a, b) => {
        if (sortBy === 'name') {
            return (a.studentName || '').localeCompare(b.studentName || '', 'th');
        } else {
            return (a.studentId || '').localeCompare(b.studentId || '');
        }
    });

    const handleAdd = async () => {
        if (!selectedStudent) {
            alert('กรุณาเลือกนิสิต');
            return;
        }

        setLoading(true);
        try {
            if (addMode === 'checkin') {
                await onAddCheckIn(session.id, selectedStudent, classroom?.name || '');
            } else {
                await onAddLeave(session.id, selectedStudent, classroom?.name || '', leaveReason);
            }
            await refreshAttendance?.();
            setSelectedStudent(null);
            setLeaveReason('');
            setMode('view');
        } catch (error) {
            alert(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (item) => {
        if (!confirm(`ต้องการลบการเช็คชื่อของ ${item.studentName}?`)) return;

        setLoading(true);
        try {
            await onDeleteAttendance(item.id);
            await refreshAttendance?.();
        } catch (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (item) => {
        setSelectedAttendance(item);
        setLeaveReason(item.leaveReason || '');
        setMode('edit');
    };

    const handleSaveEdit = async () => {
        if (!selectedAttendance) return;

        setLoading(true);
        try {
            await onUpdateAttendance(selectedAttendance.id, {
                leaveReason: leaveReason
            });
            await refreshAttendance?.();
            setSelectedAttendance(null);
            setMode('view');
        } catch (error) {
            alert('เกิดข้อผิดพลาด: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const getTypeBadge = (type) => {
        switch (type) {
            case 'manual':
                return { text: '✎ อาจารย์เช็ค', color: 'var(--primary)' };
            case 'leave':
                return { text: '📝 ลา', color: 'var(--warning)' };
            case 'scan':
            default:
                return { text: '✓ สแกน', color: 'var(--success)' };
        }
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const renderViewMode = () => (
        <>
            {/* Sorting */}
            <div className="flex justify-between items-center mb-md">
                <span className="text-muted">
                    รายชื่อผู้เช็คชื่อ ({attendance.length} คน)
                </span>
                <div className="flex gap-sm items-center">
                    <label style={{ fontSize: '0.85rem' }}>เรียงตาม:</label>
                    <select
                        className="form-input form-select"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        style={{ width: 'auto', minWidth: '120px', padding: '0.3rem 0.5rem' }}
                    >
                        <option value="name">ชื่อ</option>
                        <option value="studentId">รหัสนิสิต</option>
                    </select>
                </div>
            </div>

            {/* Attendance List */}
            {sortedAttendance.length === 0 ? (
                <div className="text-center text-muted" style={{ padding: '2rem' }}>
                    ยังไม่มีผู้เช็คชื่อ
                </div>
            ) : (
                <div style={{
                    maxHeight: '300px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    {sortedAttendance.map((item, idx) => {
                        const badge = getTypeBadge(item.type);
                        return (
                            <div
                                key={item.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: 'var(--space-sm) var(--space-md)',
                                    borderBottom: idx < sortedAttendance.length - 1 ? '1px solid var(--border-color)' : 'none',
                                    gap: 'var(--space-sm)'
                                }}
                            >
                                <span style={{ width: '30px', opacity: 0.5 }}>{idx + 1}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500 }}>{item.studentName}</div>
                                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                                        {item.studentId}
                                        {item.leaveReason && ` • ${item.leaveReason}`}
                                    </div>
                                </div>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        padding: '0.15rem 0.5rem',
                                        borderRadius: 'var(--radius-full)',
                                        background: badge.color,
                                        color: 'white'
                                    }}
                                >
                                    {badge.text}
                                </span>
                                <span style={{ fontSize: '0.8rem', opacity: 0.7, width: '50px' }}>
                                    {formatTime(item.checkedAt)}
                                </span>
                                {/* Actions */}
                                <div className="flex gap-xs">
                                    {item.type === 'leave' && (
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => handleEdit(item)}
                                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                                        >
                                            ✏️
                                        </button>
                                    )}
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => handleDelete(item)}
                                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', color: 'var(--error)' }}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add Button */}
            <button
                className="btn btn-primary"
                onClick={() => setMode('add')}
                style={{ marginTop: 'var(--space-md)', width: '100%' }}
            >
                ➕ เพิ่มการเช็คชื่อ
            </button>
        </>
    );

    const renderAddMode = () => (
        <>
            {/* Mode Toggle */}
            <div style={{
                display: 'flex',
                gap: 'var(--space-sm)',
                marginBottom: 'var(--space-lg)'
            }}>
                <button
                    className={`btn ${addMode === 'checkin' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setAddMode('checkin')}
                    style={{ flex: 1 }}
                >
                    ✓ เช็คชื่อ
                </button>
                <button
                    className={`btn ${addMode === 'leave' ? 'btn-warning' : 'btn-secondary'}`}
                    onClick={() => setAddMode('leave')}
                    style={{ flex: 1 }}
                >
                    📝 ลา
                </button>
            </div>

            {/* Sorting */}
            <div className="flex gap-sm items-center mb-sm">
                <label style={{ fontSize: '0.85rem' }}>เรียงตาม:</label>
                <select
                    className="form-input form-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    style={{ width: 'auto', minWidth: '120px', padding: '0.3rem 0.5rem' }}
                >
                    <option value="name">ชื่อ</option>
                    <option value="studentId">รหัสนิสิต</option>
                </select>
            </div>

            {/* Search */}
            <div className="form-group">
                <input
                    type="text"
                    className="form-input"
                    placeholder="ค้นหา ชื่อ / รหัสนิสิต / email"
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
                        filteredStudents.map((student) => (
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

            {/* Leave Reason */}
            {addMode === 'leave' && (
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

            {/* Selected Preview */}
            {selectedStudent && (
                <div style={{
                    padding: 'var(--space-md)',
                    background: addMode === 'leave' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(99, 102, 241, 0.1)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                        {addMode === 'checkin' ? '✓ จะเช็คชื่อให้:' : '📝 จะบันทึกลาให้:'}
                    </div>
                    <div>{selectedStudent.name} ({selectedStudent.studentId})</div>
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-sm" style={{ marginTop: 'var(--space-md)' }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        setMode('view');
                        setSelectedStudent(null);
                    }}
                    style={{ flex: 1 }}
                    disabled={loading}
                >
                    ยกเลิก
                </button>
                <button
                    className={`btn ${addMode === 'leave' ? 'btn-warning' : 'btn-primary'}`}
                    onClick={handleAdd}
                    style={{ flex: 1 }}
                    disabled={loading || !selectedStudent}
                >
                    {loading ? 'กำลังบันทึก...' : (addMode === 'checkin' ? '✓ เช็คชื่อ' : '📝 บันทึกลา')}
                </button>
            </div>
        </>
    );

    const renderEditMode = () => (
        <>
            <div style={{ marginBottom: 'var(--space-lg)' }}>
                <div style={{ fontWeight: 600 }}>แก้ไขข้อมูลของ:</div>
                <div>{selectedAttendance?.studentName} ({selectedAttendance?.studentId})</div>
            </div>

            {selectedAttendance?.type === 'leave' && (
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

            <div className="flex gap-sm" style={{ marginTop: 'var(--space-md)' }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => {
                        setMode('view');
                        setSelectedAttendance(null);
                    }}
                    style={{ flex: 1 }}
                    disabled={loading}
                >
                    ยกเลิก
                </button>
                <button
                    className="btn btn-primary"
                    onClick={handleSaveEdit}
                    style={{ flex: 1 }}
                    disabled={loading}
                >
                    {loading ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
            </div>
        </>
    );

    const formatDate = (timestamp) => {
        if (!timestamp) return '-';
        const date = timestamp.toDate?.() || new Date(timestamp);
        return date.toLocaleDateString('th-TH', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={mode === 'add' ? '➕ เพิ่มการเช็คชื่อ' : mode === 'edit' ? '✏️ แก้ไขข้อมูล' : `📋 รายการเช็คชื่อ`}
        >
            {/* Session Info */}
            <div style={{
                padding: 'var(--space-sm)',
                background: 'var(--bg-glass)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-md)',
                fontSize: '0.9rem'
            }}>
                <div><strong>{classroom?.name}</strong></div>
                <div className="text-muted">{formatDate(session?.createdAt)}</div>
            </div>

            {mode === 'view' && renderViewMode()}
            {mode === 'add' && renderAddMode()}
            {mode === 'edit' && renderEditMode()}
        </Modal>
    );
}
