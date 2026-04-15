import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
    getStudents,
    addStudent,
    updateStudent,
    deleteStudent,
    getGroupSets,
    createGroupSet,
    deleteGroupSet,
    getStudentGroups,
    generateRandomGroups,
    updateGroup
} from '../../firebase/firestore';
import { StudentModal, ConfirmModal } from '../Modal';
import CSVImport from '../CSVImport';

export default function StudentsAndGroups({ classroom }) {
    const { user } = useAuth();
    const [students, setStudents] = useState([]);
    const [groupSets, setGroupSets] = useState([]);
    const [selectedGroupSet, setSelectedGroupSet] = useState(null);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('students'); // 'students' or 'groups'

    // Modal states
    const [showStudentModal, setShowStudentModal] = useState(false);
    const [showCSVModal, setShowCSVModal] = useState(false);
    const [editingStudent, setEditingStudent] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);

    useEffect(() => {
        const loadData = async () => {
            if (!classroom?.id) return;
            setLoading(true);
            try {
                const [studentsData, sets] = await Promise.all([
                    getStudents(classroom.id),
                    getGroupSets(classroom.id)
                ]);
                setStudents(studentsData);
                setGroupSets(sets);
                if (sets.length > 0) setSelectedGroupSet(sets[0]);
            } finally { setLoading(false); }
        };
        loadData();
    }, [classroom?.id]);

    useEffect(() => {
        const loadGroups = async () => {
            if (!selectedGroupSet?.id) { setGroups([]); return; }
            const data = await getStudentGroups(selectedGroupSet.id);
            setGroups(data);
        };
        loadGroups();
    }, [selectedGroupSet?.id]);

    const handleAddStudent = async (data) => {
        const id = await addStudent(classroom.id, data);
        setStudents(prev => [...prev, { id, ...data }].sort((a, b) => a.name.localeCompare(b.name)));
    };

    if (loading) return <div className="text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-lg">
                <div className="flex gap-sm">
                    <button className={`btn ${view === 'students' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('students')}>👤 รายชื่อนักศึกษา</button>
                    <button className={`btn ${view === 'groups' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('groups')}>👥 กลุ่มเรียน</button>
                </div>
                {view === 'students' && (
                    <div className="flex gap-sm">
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowCSVModal(true)}>นำเข้า CSV</button>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowStudentModal(true)}>+ เพิ่มนักศึกษา</button>
                    </div>
                )}
            </div>

            {view === 'students' ? (
                <div className="card">
                    <table className="table w-full">
                        <thead>
                            <tr className="text-left border-b">
                                <th className="p-sm">ชื่อ-นามสกุล</th>
                                <th className="p-sm">รหัสนักศึกษา</th>
                                <th className="p-sm">Email</th>
                            </tr>
                        </thead>
                        <tbody>
                            {students.map(s => (
                                <tr key={s.id} className="border-b">
                                    <td className="p-sm font-medium">{s.name}</td>
                                    <td className="p-sm">{s.studentId}</td>
                                    <td className="p-sm text-muted">{s.email}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div>
                    <div className="card mb-lg">
                        <div className="card-header"><h3 className="card-title">จัดการกลุ่ม</h3></div>
                        {groupSets.length === 0 ? <p className="text-center p-xl text-muted">ยังไม่มีการจัดกลุ่ม</p> : (
                            <div className="p-md">
                                <select className="form-input mb-md" value={selectedGroupSet?.id || ''} onChange={e => setSelectedGroupSet(groupSets.find(s => s.id === e.target.value))}>
                                    {groupSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
                                    {groups.map(g => (
                                        <div key={g.id} className="p-md bg-secondary rounded border-l-4" style={{ background: 'var(--bg-secondary)', borderLeft: `4px solid ${g.color || 'var(--primary)'}` }}>
                                            <div className="font-bold">{g.name}</div>
                                            <div className="text-sm text-muted">{(g.studentIds || []).length} นักศึกษา</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <StudentModal isOpen={showStudentModal} onClose={() => setShowStudentModal(false)} onSubmit={handleAddStudent} />
            <CSVImport isOpen={showCSVModal} onClose={() => setShowCSVModal(false)} onImport={handleAddStudent} />
        </div>
    );
}
