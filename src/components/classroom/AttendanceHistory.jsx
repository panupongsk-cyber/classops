import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../context/AuthContext';
import { getExitTicketByStudent, submitExitTicket, isExitTicketOpen } from '../../firebase/firestore';
import ExitTicketModal from '../ExitTicketModal';

export default function AttendanceHistory({ classroomId }) {
    const { user } = useAuth();
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);
    const [exitTicketModalOpen, setExitTicketModalOpen] = useState(false);
    const [selectedAttendance, setSelectedAttendance] = useState(null);
    const [exitTicketStatus, setExitTicketStatus] = useState({});

    useEffect(() => {
        const loadHistory = async () => {
            if (!user?.email || !classroomId) return;
            setLoading(true);
            try {
                const q = query(
                    collection(db, 'attendance'),
                    where('studentEmail', '==', user.email.toLowerCase()),
                    where('classroomId', '==', classroomId)
                );
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                data.sort((a, b) => (b.checkedAt?.toDate?.() || 0) - (a.checkedAt?.toDate?.() || 0));
                setAttendance(data);

                const statusMap = {};
                for (const item of data) {
                    const existingTicket = await getExitTicketByStudent(item.sessionId, user.email);
                    let sessionOpen = false;
                    const sessionDoc = await getDoc(doc(db, 'sessions', item.sessionId));
                    if (sessionDoc.exists()) sessionOpen = isExitTicketOpen(sessionDoc.data());
                    statusMap[item.sessionId] = { submitted: !!existingTicket, open: sessionOpen };
                }
                setExitTicketStatus(statusMap);
            } finally { setLoading(false); }
        };
        loadHistory();
    }, [user?.email, classroomId]);

    const handleOpenExitTicket = (item) => {
        setSelectedAttendance(item);
        setExitTicketModalOpen(true);
    };

    const handleSubmitExitTicket = async (sessionId, cid, studentData, rating, reason, keyTakeaway) => {
        await submitExitTicket(sessionId, cid, studentData, rating, reason, keyTakeaway);
        setExitTicketStatus(prev => ({ ...prev, [sessionId]: { ...prev[sessionId], submitted: true } }));
    };

    if (loading) return <div className="text-center py-xl"><div className="spinner"></div></div>;

    return (
        <div className="card">
            <div className="card-header"><h3 className="card-title">ประวัติการเช็คชื่อ</h3></div>
            {attendance.length === 0 ? <p className="text-center p-xl text-muted">ยังไม่มีประวัติในรายวิชานี้</p> : (
                <div className="flex flex-col gap-sm">
                    {attendance.map(item => {
                        const status = exitTicketStatus[item.sessionId];
                        const canSubmit = status?.open && !status?.submitted;
                        return (
                            <div key={item.id} className="p-md bg-secondary rounded border" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="font-bold">✓ เข้าเรียน</div>
                                        <div className="text-sm text-muted">{item.checkedAt?.toDate?.().toLocaleString('th-TH')}</div>
                                    </div>
                                    {status?.submitted && <span className="text-xs text-success">✓ ส่ง Exit Ticket แล้ว</span>}
                                </div>
                                {canSubmit && <button className="btn btn-primary btn-sm w-full mt-sm" onClick={() => handleOpenExitTicket(item)}>📝 ส่ง Exit Ticket</button>}
                            </div>
                        );
                    })}
                </div>
            )}
            <ExitTicketModal isOpen={exitTicketModalOpen} onClose={() => setExitTicketModalOpen(false)} onSubmit={handleSubmitExitTicket} sessionId={selectedAttendance?.sessionId} classroomId={classroomId} studentData={{ studentId: selectedAttendance?.studentId || '', email: user?.email || '', name: selectedAttendance?.studentName || '' }} />
        </div>
    );
}
