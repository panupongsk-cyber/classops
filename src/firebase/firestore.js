import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    getDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    setDoc
} from 'firebase/firestore';
import { db } from './firebase';

// ============================================
// Admin Configuration
// ============================================

export const ADMIN_EMAIL = 'panupongs@nu.ac.th';

export const isAdmin = (email) => {
    return email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
};

// ============================================
// Allowed Teachers (managed by Admin)
// ============================================

// Helper: timeout wrapper for Firestore operations
const withTimeout = (promise, ms = 10000) => {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Operation timed out')), ms)
        )
    ]);
};

export const addAllowedTeacher = async (email, name) => {
    console.log('📝 addAllowedTeacher: Starting...', { email, name });
    const docRef = doc(db, 'allowed_teachers', email.toLowerCase());
    try {
        await withTimeout(setDoc(docRef, {
            email: email.toLowerCase(),
            name,
            role: 'teacher',
            createdAt: serverTimestamp()
        }), 15000);
        console.log('📝 addAllowedTeacher: Success');
        return email.toLowerCase();
    } catch (error) {
        console.error('📝 addAllowedTeacher: Failed', error);
        throw error;
    }
};

export const removeAllowedTeacher = async (email) => {
    console.log('🗑️ removeAllowedTeacher: Starting...', email);
    try {
        await withTimeout(deleteDoc(doc(db, 'allowed_teachers', email.toLowerCase())), 15000);
        console.log('🗑️ removeAllowedTeacher: Success');
    } catch (error) {
        console.error('🗑️ removeAllowedTeacher: Failed', error);
        throw error;
    }
};

export const getAllowedTeachers = async () => {
    console.log('📚 getAllowedTeachers: Starting...');
    try {
        const snapshot = await withTimeout(getDocs(collection(db, 'allowed_teachers')), 15000);
        const teachers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log('📚 getAllowedTeachers: Found', teachers.length);
        return teachers;
    } catch (error) {
        console.error('📚 getAllowedTeachers: Failed', error);
        throw error;
    }
};

export const isAllowedTeacher = async (email) => {
    const docRef = doc(db, 'allowed_teachers', email.toLowerCase());
    const snapshot = await getDoc(docRef);
    return snapshot.exists();
};

export const getAllowedTeacherByEmail = async (email) => {
    const docRef = doc(db, 'allowed_teachers', email.toLowerCase());
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
        return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
};

// ============================================
// Classrooms
// ============================================

// Create classroom with multiple teachers support
export const createClassroom = async (teacherId, teacherEmail, data) => {
    console.log('📚 createClassroom:', { teacherId, teacherEmail, data });
    const docRef = await addDoc(collection(db, 'classrooms'), {
        // Support multiple teachers - store as array
        teacherIds: [teacherId],
        teacherEmails: [teacherEmail?.toLowerCase()],
        name: data.name,
        code: data.code || generateClassCode(),
        qrInterval: data.qrInterval || 30,
        createdAt: serverTimestamp()
    });
    console.log('📚 createClassroom: Created', docRef.id);
    return docRef.id;
};

// Get classrooms for a teacher (uses array-contains)
export const getClassrooms = async (teacherId) => {
    console.log('📚 getClassrooms: Loading for teacher', teacherId);
    const q = query(
        collection(db, 'classrooms'),
        where('teacherIds', 'array-contains', teacherId),
        orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    const classrooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log('📚 getClassrooms: Found', classrooms.length);
    return classrooms;
};

// Get all classrooms (for admin)
export const getAllClassrooms = async () => {
    console.log('📚 getAllClassrooms: Loading all...');
    const q = query(
        collection(db, 'classrooms'),
        orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    const classrooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log('📚 getAllClassrooms: Found', classrooms.length);
    return classrooms;
};

// Add teacher to classroom
export const addTeacherToClassroom = async (classroomId, teacherId, teacherEmail) => {
    console.log('📚 addTeacherToClassroom:', { classroomId, teacherId, teacherEmail });
    const docRef = doc(db, 'classrooms', classroomId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
        throw new Error('Classroom not found');
    }

    const data = snapshot.data();
    const teacherIds = data.teacherIds || [data.teacherId];
    const teacherEmails = data.teacherEmails || [];

    if (!teacherIds.includes(teacherId)) {
        teacherIds.push(teacherId);
    }
    if (teacherEmail && !teacherEmails.includes(teacherEmail.toLowerCase())) {
        teacherEmails.push(teacherEmail.toLowerCase());
    }

    await updateDoc(docRef, { teacherIds, teacherEmails });
    console.log('📚 addTeacherToClassroom: Success');
};

// Remove teacher from classroom
export const removeTeacherFromClassroom = async (classroomId, teacherId, teacherEmail) => {
    console.log('📚 removeTeacherFromClassroom:', { classroomId, teacherId, teacherEmail });
    const docRef = doc(db, 'classrooms', classroomId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
        throw new Error('Classroom not found');
    }

    const data = snapshot.data();
    let teacherIds = data.teacherIds || [];
    let teacherEmails = data.teacherEmails || [];

    teacherIds = teacherIds.filter(id => id !== teacherId);
    if (teacherEmail) {
        teacherEmails = teacherEmails.filter(e => e !== teacherEmail.toLowerCase());
    }

    await updateDoc(docRef, { teacherIds, teacherEmails });
    console.log('📚 removeTeacherFromClassroom: Success');
};

export const getClassroom = async (classroomId) => {
    const docRef = doc(db, 'classrooms', classroomId);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
        return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
};

export const updateClassroom = async (classroomId, data) => {
    const docRef = doc(db, 'classrooms', classroomId);
    await updateDoc(docRef, data);
};

export const deleteClassroom = async (classroomId) => {
    const docRef = doc(db, 'classrooms', classroomId);
    await deleteDoc(docRef);
};

// ============================================
// Students
// ============================================

export const addStudent = async (classroomId, data) => {
    const docRef = await addDoc(collection(db, 'students'), {
        classroomId,
        email: data.email.toLowerCase(),
        studentId: data.studentId,
        name: data.name,
        createdAt: serverTimestamp()
    });
    return docRef.id;
};

export const getStudents = async (classroomId) => {
    console.log('📚 getStudents: Loading for classroom', classroomId);
    try {
        const q = query(
            collection(db, 'students'),
            where('classroomId', '==', classroomId)
        );
        const snapshot = await getDocs(q);
        const students = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort by name in JavaScript
        students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        console.log('📚 getStudents: Found', students.length);
        return students;
    } catch (error) {
        console.error('📚 getStudents: Error', error);
        throw error;
    }
};

export const getStudentByEmail = async (classroomId, email) => {
    try {
        console.log('Looking for student:', { classroomId, email: email.toLowerCase() });

        // Get all students in classroom and filter by email
        // This avoids needing composite index
        const q = query(
            collection(db, 'students'),
            where('classroomId', '==', classroomId)
        );
        const snapshot = await getDocs(q);

        console.log('Found students in classroom:', snapshot.docs.length);

        const student = snapshot.docs.find(doc =>
            doc.data().email?.toLowerCase() === email.toLowerCase()
        );

        if (student) {
            console.log('Student found:', student.data());
            return { id: student.id, ...student.data() };
        }

        console.log('Student not found with email:', email);
        return null;
    } catch (error) {
        console.error('Error finding student:', error);
        throw error;
    }
};

export const updateStudent = async (studentId, data) => {
    const docRef = doc(db, 'students', studentId);
    await updateDoc(docRef, data);
};

// Find student by email (across all classrooms) - for login validation
export const findStudentByEmail = async (email) => {
    console.log('🔍 findStudentByEmail:', email);
    try {
        const q = query(
            collection(db, 'students'),
            where('email', '==', email.toLowerCase())
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            const studentDoc = snapshot.docs[0];
            console.log('✅ Student found:', studentDoc.data());
            return { id: studentDoc.id, ...studentDoc.data() };
        }

        console.log('❌ Student not found');
        return null;
    } catch (error) {
        console.error('❌ findStudentByEmail error:', error);
        return null;
    }
};

export const deleteStudent = async (studentId) => {
    const docRef = doc(db, 'students', studentId);
    await deleteDoc(docRef);
};

// ============================================
// Sessions
// ============================================

export const createSession = async (classroomId, qrInterval) => {
    const token = generateToken();
    const expiry = Timestamp.fromDate(new Date(Date.now() + qrInterval * 1000));

    const docRef = await addDoc(collection(db, 'sessions'), {
        classroomId,
        activeToken: token,
        tokenExpiry: expiry,
        qrInterval,
        isActive: true,
        createdAt: serverTimestamp()
    });

    return { id: docRef.id, token, expiry };
};

export const getActiveSession = async (classroomId) => {
    const q = query(
        collection(db, 'sessions'),
        where('classroomId', '==', classroomId),
        where('isActive', '==', true)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    }
    return null;
};

export const refreshSessionToken = async (sessionId, qrInterval) => {
    const token = generateToken();
    const expiry = Timestamp.fromDate(new Date(Date.now() + qrInterval * 1000));

    const docRef = doc(db, 'sessions', sessionId);
    await updateDoc(docRef, {
        activeToken: token,
        tokenExpiry: expiry
    });

    return { token, expiry };
};

export const endSession = async (sessionId) => {
    const docRef = doc(db, 'sessions', sessionId);
    await updateDoc(docRef, {
        isActive: false,
        endedAt: serverTimestamp()
    });
};

export const subscribeToSession = (sessionId, callback) => {
    const docRef = doc(db, 'sessions', sessionId);
    return onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
            callback({ id: doc.id, ...doc.data() });
        }
    });
};

// ============================================
// Attendance
// ============================================

export const recordAttendance = async (sessionId, studentData, token, classroomName = '') => {
    // Check if already checked in
    const existing = await getAttendanceByEmail(sessionId, studentData.email);
    if (existing) {
        throw new Error('คุณได้เช็คชื่อแล้วสำหรับคาบนี้');
    }

    const docRef = await addDoc(collection(db, 'attendance'), {
        sessionId,
        studentEmail: studentData.email,
        studentId: studentData.studentId,
        studentName: studentData.name,
        classroomName: classroomName,
        tokenUsed: token,
        checkedAt: serverTimestamp()
    });

    return docRef.id;
};

export const getAttendanceByEmail = async (sessionId, email) => {
    const q = query(
        collection(db, 'attendance'),
        where('sessionId', '==', sessionId),
        where('studentEmail', '==', email.toLowerCase())
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    }
    return null;
};

export const getSessionAttendance = async (sessionId) => {
    const q = query(
        collection(db, 'attendance'),
        where('sessionId', '==', sessionId),
        orderBy('checkedAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const subscribeToAttendance = (sessionId, callback) => {
    const q = query(
        collection(db, 'attendance'),
        where('sessionId', '==', sessionId),
        orderBy('checkedAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
        const attendance = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(attendance);
    });
};

// ============================================
// QR Code Validation
// ============================================

export const validateQRCode = async (qrData, userEmail) => {
    try {
        console.log('=== QR Validation Start ===');
        console.log('QR Data:', qrData);
        console.log('User Email:', userEmail);

        const data = JSON.parse(qrData);
        const { sessionId, token, expiry, classroomId } = data;

        console.log('Parsed QR:', { sessionId, token: token?.substring(0, 8) + '...', expiry, classroomId });

        // Check token expiry
        const now = Date.now();
        console.log('Time check:', { now, expiry, diff: expiry - now });
        if (now > expiry) {
            throw new Error('QR Code หมดอายุแล้ว กรุณารอ QR Code ใหม่');
        }

        // Get session and verify token
        console.log('Fetching session:', sessionId);
        const sessionDoc = await getDoc(doc(db, 'sessions', sessionId));
        if (!sessionDoc.exists()) {
            console.log('Session not found');
            throw new Error('ไม่พบการเช็คชื่อนี้');
        }

        const session = sessionDoc.data();
        console.log('Session data:', { isActive: session.isActive, tokenMatch: session.activeToken === token });

        if (!session.isActive) {
            throw new Error('การเช็คชื่อสิ้นสุดแล้ว');
        }

        if (session.activeToken !== token) {
            throw new Error('QR Code ไม่ถูกต้องหรือหมดอายุแล้ว');
        }

        // Find student by email in classroom
        console.log('Finding student by email...');
        const student = await getStudentByEmail(classroomId, userEmail);
        if (!student) {
            throw new Error('คุณไม่ได้ลงทะเบียนในวิชานี้');
        }

        // Get classroom name for attendance record
        let classroomName = '';
        try {
            const classroomDoc = await getDoc(doc(db, 'classrooms', classroomId));
            if (classroomDoc.exists()) {
                classroomName = classroomDoc.data().name || '';
            }
        } catch (e) {
            console.log('Could not get classroom name:', e);
        }

        // Record attendance with classroom name
        console.log('Recording attendance...');
        await recordAttendance(sessionId, student, token, classroomName);

        console.log('=== QR Validation Success ===');
        return {
            success: true,
            message: 'เช็คชื่อสำเร็จ',
            student
        };

    } catch (error) {
        console.error('=== QR Validation Error ===', error);
        if (error.message) {
            throw error;
        }
        throw new Error('QR Code ไม่ถูกต้อง');
    }
};

// ============================================
// Utilities
// ============================================

const generateToken = () => {
    return crypto.randomUUID();
};

const generateClassCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

export const generateQRData = (sessionId, classroomId, token, qrInterval) => {
    return JSON.stringify({
        sessionId,
        classroomId,
        token,
        expiry: Date.now() + qrInterval * 1000,
        v: 1
    });
};
