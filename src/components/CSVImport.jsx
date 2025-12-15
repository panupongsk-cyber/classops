import { useState, useRef } from 'react';
import Modal from './Modal';

const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
);

const FileIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" x2="8" y1="13" y2="13" />
        <line x1="16" x2="8" y1="17" y2="17" />
        <line x1="10" x2="8" y1="9" y2="9" />
    </svg>
);

const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const XIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" x2="6" y1="6" y2="18" />
        <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
);

// Parse CSV text to array of objects
function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());

    // Find column indices
    const nameIdx = header.findIndex(h =>
        h.includes('name') || h.includes('ชื่อ') || h === 'fullname' || h === 'student_name'
    );
    const emailIdx = header.findIndex(h =>
        h.includes('email') || h.includes('อีเมล') || h === 'e-mail'
    );
    const idIdx = header.findIndex(h =>
        h.includes('id') || h.includes('รหัส') || h === 'student_id' || h === 'studentid' || h === 'code'
    );

    // Parse data rows
    const students = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Handle quoted values with commas
        const values = [];
        let current = '';
        let inQuotes = false;
        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());

        const student = {
            name: nameIdx >= 0 ? values[nameIdx] : '',
            email: emailIdx >= 0 ? values[emailIdx] : '',
            studentId: idIdx >= 0 ? values[idIdx] : '',
            valid: true,
            error: ''
        };

        // Validate
        if (!student.name) {
            student.valid = false;
            student.error = 'ไม่มีชื่อ';
        } else if (!student.email) {
            student.valid = false;
            student.error = 'ไม่มี email';
        } else if (!student.email.includes('@')) {
            student.valid = false;
            student.error = 'email ไม่ถูกต้อง';
        } else if (!student.studentId) {
            student.valid = false;
            student.error = 'ไม่มีรหัสนักศึกษา';
        }

        students.push(student);
    }

    return students;
}

export default function CSVImport({ isOpen, onClose, onImport }) {
    const [file, setFile] = useState(null);
    const [students, setStudents] = useState([]);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState(null);
    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setResult(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            const parsed = parseCSV(text);
            setStudents(parsed);
        };
        reader.readAsText(selectedFile, 'UTF-8');
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && droppedFile.name.endsWith('.csv')) {
            setFile(droppedFile);
            setResult(null);

            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target.result;
                const parsed = parseCSV(text);
                setStudents(parsed);
            };
            reader.readAsText(droppedFile, 'UTF-8');
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    const handleImport = async () => {
        const validStudents = students.filter(s => s.valid);
        if (validStudents.length === 0) return;

        setImporting(true);
        try {
            let success = 0;
            let failed = 0;

            for (const student of validStudents) {
                try {
                    await onImport({
                        name: student.name,
                        email: student.email,
                        studentId: student.studentId
                    });
                    success++;
                } catch (err) {
                    failed++;
                }
            }

            setResult({ success, failed });
        } catch (error) {
            console.error('Import failed:', error);
        } finally {
            setImporting(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setStudents([]);
        setResult(null);
        onClose();
    };

    const validCount = students.filter(s => s.valid).length;
    const invalidCount = students.filter(s => !s.valid).length;

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="นำเข้านักศึกษาจาก CSV"
            footer={
                result ? (
                    <button className="btn btn-primary" onClick={handleClose}>
                        เสร็จสิ้น
                    </button>
                ) : (
                    <>
                        <button className="btn btn-secondary" onClick={handleClose} disabled={importing}>
                            ยกเลิก
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleImport}
                            disabled={importing || validCount === 0}
                        >
                            {importing ? 'กำลังนำเข้า...' : `นำเข้า ${validCount} คน`}
                        </button>
                    </>
                )
            }
        >
            {result ? (
                <div className="text-center" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{
                        width: '60px',
                        height: '60px',
                        borderRadius: 'var(--radius-full)',
                        background: 'rgba(34, 197, 94, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto var(--space-lg)',
                        color: 'var(--success)',
                        fontSize: '2rem'
                    }}>
                        ✓
                    </div>
                    <h3 style={{ marginBottom: 'var(--space-sm)' }}>นำเข้าเสร็จสิ้น!</h3>
                    <p className="text-muted">
                        สำเร็จ {result.success} คน
                        {result.failed > 0 && `, ล้มเหลว ${result.failed} คน`}
                    </p>
                </div>
            ) : !file ? (
                <>
                    {/* Drop Zone */}
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        style={{
                            border: '2px dashed var(--border-color)',
                            borderRadius: 'var(--radius-lg)',
                            padding: 'var(--space-2xl)',
                            textAlign: 'center',
                            cursor: 'pointer',
                            transition: 'all var(--transition-fast)'
                        }}
                    >
                        <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                            <FileIcon />
                        </div>
                        <p style={{ marginBottom: 'var(--space-sm)' }}>
                            ลากไฟล์มาวางที่นี่ หรือ <span style={{ color: 'var(--primary-light)' }}>เลือกไฟล์</span>
                        </p>
                        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                            รองรับไฟล์ .csv
                        </p>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                    />

                    {/* CSV Format Guide */}
                    <div style={{
                        marginTop: 'var(--space-lg)',
                        padding: 'var(--space-md)',
                        background: 'var(--bg-glass)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem'
                    }}>
                        <strong>รูปแบบ CSV ที่รองรับ:</strong>
                        <pre style={{
                            marginTop: 'var(--space-sm)',
                            padding: 'var(--space-sm)',
                            background: 'rgba(0,0,0,0.2)',
                            borderRadius: 'var(--radius-sm)',
                            overflow: 'auto'
                        }}>
                            name,email,student_id{'\n'}
                            สมชาย ใจดี,somchai@email.com,6401001{'\n'}
                            สมหญิง ใจงาม,somying@email.com,6401002
                        </pre>
                    </div>
                </>
            ) : (
                <>
                    {/* File Info */}
                    <div className="flex items-center gap-md mb-lg" style={{
                        padding: 'var(--space-md)',
                        background: 'var(--bg-glass)',
                        borderRadius: 'var(--radius-md)'
                    }}>
                        <FileIcon />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500 }}>{file.name}</div>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                พบ {students.length} รายการ
                            </div>
                        </div>
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setFile(null);
                                setStudents([]);
                            }}
                        >
                            เลือกไฟล์อื่น
                        </button>
                    </div>

                    {/* Summary */}
                    <div className="flex gap-md mb-lg">
                        <div style={{
                            flex: 1,
                            padding: 'var(--space-md)',
                            background: 'rgba(34, 197, 94, 0.1)',
                            borderRadius: 'var(--radius-md)',
                            textAlign: 'center'
                        }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--success)' }}>
                                {validCount}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>ถูกต้อง</div>
                        </div>
                        <div style={{
                            flex: 1,
                            padding: 'var(--space-md)',
                            background: invalidCount > 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-glass)',
                            borderRadius: 'var(--radius-md)',
                            textAlign: 'center'
                        }}>
                            <div style={{
                                fontSize: '1.5rem',
                                fontWeight: 600,
                                color: invalidCount > 0 ? 'var(--error)' : 'var(--text-muted)'
                            }}>
                                {invalidCount}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>มีปัญหา</div>
                        </div>
                    </div>

                    {/* Preview Table */}
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th style={{ width: '30px' }}></th>
                                    <th>ชื่อ</th>
                                    <th>Email</th>
                                    <th>รหัส</th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.slice(0, 50).map((student, idx) => (
                                    <tr key={idx} style={{ opacity: student.valid ? 1 : 0.5 }}>
                                        <td>
                                            {student.valid ? (
                                                <span style={{ color: 'var(--success)' }}><CheckIcon /></span>
                                            ) : (
                                                <span style={{ color: 'var(--error)' }} title={student.error}><XIcon /></span>
                                            )}
                                        </td>
                                        <td>{student.name || '-'}</td>
                                        <td>{student.email || '-'}</td>
                                        <td>{student.studentId || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {students.length > 50 && (
                            <p className="text-muted text-center mt-md">
                                แสดง 50 จาก {students.length} รายการ
                            </p>
                        )}
                    </div>
                </>
            )}
        </Modal>
    );
}
