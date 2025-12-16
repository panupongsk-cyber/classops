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


// Default settings
export const DEFAULT_CHECKIN_RADIUS = 100; // meters
export const DEFAULT_QR_INTERVAL = 30; // seconds
export const DEFAULT_GRACE_PERIOD = 10; // seconds
export const DEFAULT_REQUIRE_GPS = true;

// Get admin config from Firestore
export const getAdminConfig = async () => {
    try {
        const docRef = doc(db, 'config', 'admin');
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            return snapshot.data();
        }
        return {
            checkInRadius: DEFAULT_CHECKIN_RADIUS,
            qrInterval: DEFAULT_QR_INTERVAL,
            gracePeriod: DEFAULT_GRACE_PERIOD,
            requireGPS: DEFAULT_REQUIRE_GPS
        };
    } catch (e) {
        console.error('Error getting admin config:', e);
        return {
            checkInRadius: DEFAULT_CHECKIN_RADIUS,
            qrInterval: DEFAULT_QR_INTERVAL,
            gracePeriod: DEFAULT_GRACE_PERIOD,
            requireGPS: DEFAULT_REQUIRE_GPS
        };
    }
};

// Update admin config
export const updateAdminConfig = async (config) => {
    const docRef = doc(db, 'config', 'admin');
    await setDoc(docRef, config, { merge: true });
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

// Update user role
export const updateUserRole = async (email, newRole) => {
    console.log('📝 updateUserRole:', { email, newRole });
    const docRef = doc(db, 'allowed_teachers', email.toLowerCase());
    try {
        await updateDoc(docRef, {
            role: newRole,
            updatedAt: serverTimestamp()
        });
        console.log('📝 updateUserRole: Success');
    } catch (error) {
        console.error('📝 updateUserRole: Failed', error);
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

// Get classrooms for a teacher (uses array-contains on teacherIds or teacherEmails)
export const getClassrooms = async (teacherId, teacherEmail = null) => {
    console.log('📚 getClassrooms: Loading for teacher', teacherId, teacherEmail);
    try {
        // First try by teacherIds (UID)
        const q1 = query(
            collection(db, 'classrooms'),
            where('teacherIds', 'array-contains', teacherId)
        );
        const snapshot1 = await getDocs(q1);
        let classrooms = snapshot1.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Also check by email if provided
        if (teacherEmail) {
            const q2 = query(
                collection(db, 'classrooms'),
                where('teacherEmails', 'array-contains', teacherEmail.toLowerCase())
            );
            const snapshot2 = await getDocs(q2);
            const emailClassrooms = snapshot2.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Merge and deduplicate
            const existingIds = new Set(classrooms.map(c => c.id));
            for (const c of emailClassrooms) {
                if (!existingIds.has(c.id)) {
                    classrooms.push(c);
                }
            }
        }

        // Sort client-side by createdAt descending
        classrooms.sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
            return dateB - dateA;
        });

        console.log('📚 getClassrooms: Found', classrooms.length);
        return classrooms;
    } catch (error) {
        console.error('📚 getClassrooms: Error', error);
        return [];
    }
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
// Emoji Challenge System
// ============================================

// Pool of distinct, easy-to-recognize emojis
const EMOJI_POOL = [
    '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🥝',
    '🌟', '⭐', '🌙', '☀️', '🌈', '❄️', '🔥', '💧',
    '🎈', '🎁', '🎀', '🎯', '🎲', '🎮', '🎸', '🎺',
    '🚗', '🚕', '🚌', '🚀', '✈️', '🚁', '⛵', '🚲',
    '🐶', '🐱', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷',
    '🌸', '🌺', '🌻', '🌹', '🍀', '🌴', '🌵', '🍄'
];

// The subset of emojis shown to students (must match what generateEmojiSequence uses)
const STUDENT_EMOJI_POOL = EMOJI_POOL.slice(0, 16);

// Generate a random emoji sequence (3 emojis, no repeats) from student-visible pool
export const generateEmojiSequence = () => {
    const shuffled = [...STUDENT_EMOJI_POOL].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
};

// Get the emoji pool for student UI
export const getEmojiPool = () => {
    return STUDENT_EMOJI_POOL;
};

// ============================================
// Sessions
// ============================================

export const createSession = async (classroomId, qrInterval, location = null, checkInRadius = DEFAULT_CHECKIN_RADIUS, gracePeriod = DEFAULT_GRACE_PERIOD, requireGPS = DEFAULT_REQUIRE_GPS) => {
    const token = generateToken();
    const emojiSequence = generateEmojiSequence();
    const expiry = Timestamp.fromDate(new Date(Date.now() + qrInterval * 1000));

    // Exit ticket deadline: 24 hours from now
    const exitTicketDeadline = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const sessionData = {
        classroomId,
        activeToken: token,
        activeEmoji: emojiSequence,
        tokenExpiry: expiry,
        qrInterval,
        gracePeriod,
        requireGPS,
        isActive: true,
        createdAt: serverTimestamp(),
        // Exit ticket auto-enabled
        exitTicketEnabled: true,
        exitTicketDeadline,
        exitTicketClosedManually: false
    };

    // Add GPS location if provided
    if (location && location.latitude && location.longitude) {
        sessionData.location = {
            latitude: location.latitude,
            longitude: location.longitude
        };
        sessionData.checkInRadius = checkInRadius;
    }

    const docRef = await addDoc(collection(db, 'sessions'), sessionData);

    return { id: docRef.id, token, emojiSequence, expiry };
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
    const newEmojiSequence = generateEmojiSequence();
    const expiry = Timestamp.fromDate(new Date(Date.now() + qrInterval * 1000));
    const now = Timestamp.now();

    const docRef = doc(db, 'sessions', sessionId);

    // Get current session to save previous emoji
    const sessionDoc = await getDoc(docRef);
    const currentEmoji = sessionDoc.exists() ? sessionDoc.data().activeEmoji : null;

    const updateData = {
        activeToken: token,
        activeEmoji: newEmojiSequence,
        tokenExpiry: expiry
    };

    // Store previous emoji for grace period validation
    if (currentEmoji && currentEmoji.length > 0) {
        updateData.previousEmoji = currentEmoji;
        updateData.previousEmojiExpiry = now; // When the previous emoji was replaced
    }

    await updateDoc(docRef, updateData);

    return { token, emojiSequence: newEmojiSequence, expiry };
};

export const endSession = async (sessionId) => {
    const docRef = doc(db, 'sessions', sessionId);
    await updateDoc(docRef, {
        isActive: false,
        endedAt: serverTimestamp()
    });
};

// Update session location (for updating GPS from teacher's phone)
export const updateSessionLocation = async (sessionId, location, checkInRadius = DEFAULT_CHECKIN_RADIUS) => {
    const docRef = doc(db, 'sessions', sessionId);
    await updateDoc(docRef, {
        location: {
            latitude: location.latitude,
            longitude: location.longitude
        },
        checkInRadius,
        locationUpdatedAt: serverTimestamp()
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

export const recordAttendance = async (sessionId, studentData, token, classroomName = '', metadata = {}) => {
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
        type: 'scan', // QR/Emoji scan
        tokenUsed: token,
        userAgent: metadata.userAgent || '',
        ipAddress: metadata.ipAddress || '',
        distanceFromTeacher: metadata.distanceFromTeacher || null,
        checkedAt: serverTimestamp()
    });

    return docRef.id;
};

// Manual check-in by teacher
export const manualCheckIn = async (sessionId, studentData, classroomName = '', teacherEmail = '') => {
    const existing = await getAttendanceByEmail(sessionId, studentData.email);
    if (existing) {
        throw new Error('นิสิตได้เช็คชื่อแล้วสำหรับคาบนี้');
    }

    const docRef = await addDoc(collection(db, 'attendance'), {
        sessionId,
        studentEmail: studentData.email,
        studentId: studentData.studentId,
        studentName: studentData.name,
        classroomName,
        type: 'manual',
        checkedBy: teacherEmail,
        checkedAt: serverTimestamp()
    });
    return docRef.id;
};

// Record leave
export const recordLeave = async (sessionId, studentData, classroomName = '', reason = '', teacherEmail = '') => {
    const existing = await getAttendanceByEmail(sessionId, studentData.email);
    if (existing) {
        throw new Error('นิสิตได้เช็คชื่อ/ลาแล้วสำหรับคาบนี้');
    }

    const docRef = await addDoc(collection(db, 'attendance'), {
        sessionId,
        studentEmail: studentData.email,
        studentId: studentData.studentId,
        studentName: studentData.name,
        classroomName,
        type: 'leave',
        leaveReason: reason,
        recordedBy: teacherEmail,
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
    try {
        // Query without orderBy to avoid index issues
        const q = query(
            collection(db, 'attendance'),
            where('sessionId', '==', sessionId)
        );
        const snapshot = await getDocs(q);
        const attendance = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort client-side
        attendance.sort((a, b) => {
            const dateA = a.checkedAt?.toDate?.() || new Date(a.checkedAt) || new Date(0);
            const dateB = b.checkedAt?.toDate?.() || new Date(b.checkedAt) || new Date(0);
            return dateB - dateA;
        });

        return attendance;
    } catch (error) {
        console.error('Error getting session attendance:', error);
        return [];
    }
};

export const subscribeToAttendance = (sessionId, callback) => {
    console.log('📡 Subscribing to attendance for session:', sessionId);

    // Query without orderBy to avoid index issues, sort client-side
    const q = query(
        collection(db, 'attendance'),
        where('sessionId', '==', sessionId)
    );

    return onSnapshot(q, (snapshot) => {
        const attendance = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort by checkedAt descending (client-side)
        attendance.sort((a, b) => {
            const dateA = a.checkedAt?.toDate?.() || new Date(a.checkedAt) || new Date(0);
            const dateB = b.checkedAt?.toDate?.() || new Date(b.checkedAt) || new Date(0);
            return dateB - dateA;
        });
        console.log('📡 Attendance updated:', attendance.length, 'records');
        callback(attendance);
    }, (error) => {
        console.error('📡 Attendance subscription error:', error);
        callback([]);
    });
};

// Get all sessions with pagination
export const getAllSessions = async (limit = 50) => {
    const q = query(
        collection(db, 'sessions'),
        orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    const sessions = [];

    for (const sessionDoc of snapshot.docs.slice(0, limit)) {
        const session = { id: sessionDoc.id, ...sessionDoc.data() };

        // Get classroom name
        if (session.classroomId) {
            try {
                const classroomDoc = await getDoc(doc(db, 'classrooms', session.classroomId));
                if (classroomDoc.exists()) {
                    session.classroomName = classroomDoc.data().name || '';
                }
            } catch (e) {
                console.log('Could not get classroom for session:', e);
            }
        }

        // Get attendance count
        const attendanceQuery = query(
            collection(db, 'attendance'),
            where('sessionId', '==', sessionDoc.id)
        );
        const attendanceSnapshot = await getDocs(attendanceQuery);
        session.attendanceCount = attendanceSnapshot.size;

        sessions.push(session);
    }

    return sessions;
};

// Get sessions for a specific classroom with attendance counts
export const getSessionsForClassroom = async (classroomId, limit = 50) => {
    console.log('📚 getSessionsForClassroom:', classroomId);
    try {
        // Query without orderBy to avoid composite index requirement
        const q = query(
            collection(db, 'sessions'),
            where('classroomId', '==', classroomId)
        );
        const snapshot = await getDocs(q);
        const sessions = [];

        for (const sessionDoc of snapshot.docs) {
            const session = { id: sessionDoc.id, ...sessionDoc.data() };

            // Get attendance count
            const attendanceQuery = query(
                collection(db, 'attendance'),
                where('sessionId', '==', sessionDoc.id)
            );
            const attendanceSnapshot = await getDocs(attendanceQuery);
            session.attendanceCount = attendanceSnapshot.size;

            sessions.push(session);
        }

        // Sort client-side by createdAt descending
        sessions.sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
            return dateB - dateA;
        });

        // Apply limit after sorting
        const limitedSessions = sessions.slice(0, limit);

        console.log('📚 getSessionsForClassroom: Found', limitedSessions.length, 'sessions');
        return limitedSessions;
    } catch (error) {
        console.error('📚 getSessionsForClassroom: Error', error);
        return [];
    }
};

// Delete attendance record
export const deleteAttendance = async (attendanceId) => {
    const docRef = doc(db, 'attendance', attendanceId);
    await deleteDoc(docRef);
};

// Delete session and all its attendance records
export const deleteSession = async (sessionId) => {
    console.log('🗑️ deleteSession: Starting...', sessionId);
    try {
        // First, delete all attendance records for this session
        const attendanceQuery = query(
            collection(db, 'attendance'),
            where('sessionId', '==', sessionId)
        );
        const snapshot = await getDocs(attendanceQuery);
        console.log('🗑️ deleteSession: Found', snapshot.size, 'attendance records to delete');

        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);

        // Then delete the session
        const sessionRef = doc(db, 'sessions', sessionId);
        await deleteDoc(sessionRef);
        console.log('🗑️ deleteSession: Success');
    } catch (error) {
        console.error('🗑️ deleteSession: Failed', error);
        throw error;
    }
};

// Update attendance record
export const updateAttendance = async (attendanceId, data) => {
    const docRef = doc(db, 'attendance', attendanceId);
    await updateDoc(docRef, data);
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

// Base URL for the app
const APP_BASE_URL = 'https://attendance-13d17.web.app';

export const generateQRData = (sessionId, classroomId, token, qrInterval) => {
    // Generate URL with encoded parameters
    const params = new URLSearchParams({
        s: sessionId,
        c: classroomId,
        t: token,
        e: String(Date.now() + qrInterval * 1000)
    });
    return `${APP_BASE_URL}/checkin?${params.toString()}`;
};

// Calculate distance between two GPS coordinates using Haversine formula
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
};

// Validate check-in from URL parameters
export const validateCheckInCode = async (sessionId, classroomId, token, expiry, userEmail, metadata = {}) => {
    try {
        console.log('=== Check-in Validation Start ===');
        console.log('Params:', { sessionId, classroomId, userEmail });

        // Get session and verify it's active
        console.log('Fetching session:', sessionId);
        const sessionDoc = await getDoc(doc(db, 'sessions', sessionId));
        if (!sessionDoc.exists()) {
            console.log('Session not found');
            throw new Error('ไม่พบการเช็คชื่อนี้');
        }

        const session = sessionDoc.data();
        console.log('Session data:', { isActive: session.isActive, classroomId: session.classroomId, hasLocation: !!session.location, hasEmoji: !!session.activeEmoji });

        // Only check if session is active
        if (!session.isActive) {
            throw new Error('การเช็คชื่อสิ้นสุดแล้ว กรุณาติดต่ออาจารย์');
        }

        // Verify classroomId matches
        if (session.classroomId !== classroomId) {
            throw new Error('QR Code ไม่ถูกต้อง');
        }

        // Emoji sequence validation
        if (session.activeEmoji && session.activeEmoji.length > 0) {
            console.log('Emoji validation required');
            console.log('Session emoji:', session.activeEmoji);
            console.log('Previous emoji:', session.previousEmoji);
            console.log('Submitted emoji:', metadata.emojiSequence);

            if (!metadata.emojiSequence || !Array.isArray(metadata.emojiSequence)) {
                throw new Error('กรุณาเลือก emoji ตามลำดับที่แสดงบนหน้าจอ');
            }

            const submittedEmoji = metadata.emojiSequence.join('');
            const currentEmoji = session.activeEmoji.join('');

            let emojiValid = false;

            // Check against current emoji
            if (currentEmoji === submittedEmoji) {
                console.log('Matched current emoji!');
                emojiValid = true;
            }

            // Check against previous emoji within grace period
            if (!emojiValid && session.previousEmoji && session.previousEmoji.length > 0) {
                const previousEmoji = session.previousEmoji.join('');

                if (previousEmoji === submittedEmoji) {
                    // Check if still within grace period
                    const gracePeriod = session.gracePeriod || DEFAULT_GRACE_PERIOD;
                    const previousEmojiExpiry = session.previousEmojiExpiry?.toDate?.() || new Date(0);
                    const gracePeriodEnd = new Date(previousEmojiExpiry.getTime() + gracePeriod * 1000);

                    if (new Date() <= gracePeriodEnd) {
                        console.log('Matched previous emoji within grace period!');
                        emojiValid = true;
                    } else {
                        console.log('Previous emoji expired:', {
                            gracePeriodEnd: gracePeriodEnd.toISOString(),
                            now: new Date().toISOString()
                        });
                    }
                }
            }

            if (!emojiValid) {
                console.log('Emoji mismatch:', { expected: currentEmoji, got: submittedEmoji });
                throw new Error('ลำดับ emoji ไม่ถูกต้อง กรุณาดูหน้าจออาจารย์อีกครั้ง');
            }

            console.log('Emoji validation passed!');
        }

        // GPS Location validation
        // Default to true if not set (for backward compatibility)
        const requireGPS = session.requireGPS !== false;

        if (requireGPS && session.location) {
            console.log('GPS validation required');

            // Check if student provided location
            if (!metadata.location || !metadata.location.latitude || !metadata.location.longitude) {
                throw new Error('กรุณาอนุญาตการเข้าถึงตำแหน่ง GPS เพื่อเช็คชื่อ');
            }

            // Calculate distance
            const distance = calculateDistance(
                session.location.latitude,
                session.location.longitude,
                metadata.location.latitude,
                metadata.location.longitude
            );

            const checkInRadius = session.checkInRadius || DEFAULT_CHECKIN_RADIUS;
            console.log('GPS check:', { distance: Math.round(distance), checkInRadius });

            // Store distance in metadata
            metadata.distanceFromTeacher = Math.round(distance);

            if (distance > checkInRadius) {
                throw new Error(`คุณไม่ได้อยู่ในห้องเรียน (ระยะห่าง ${Math.round(distance)} เมตร, อนุญาต ${checkInRadius} เมตร)`);
            }
        }

        // Find student by email in classroom
        console.log('Finding student by email...');
        const student = await getStudentByEmail(classroomId, userEmail);
        if (!student) {
            throw new Error('คุณไม่ได้ลงทะเบียนในวิชานี้');
        }

        // Get classroom info
        let classroomName = '';
        let classroom = null;
        try {
            const classroomDoc = await getDoc(doc(db, 'classrooms', classroomId));
            if (classroomDoc.exists()) {
                classroom = { id: classroomDoc.id, ...classroomDoc.data() };
                classroomName = classroom.name || '';
            }
        } catch (e) {
            console.log('Could not get classroom:', e);
        }

        // Record attendance with classroom name and metadata
        console.log('Recording attendance with metadata:', metadata);
        await recordAttendance(sessionId, student, token, classroomName, metadata);

        console.log('=== Check-in Validation Success ===');
        return {
            success: true,
            message: 'เช็คชื่อสำเร็จ',
            student,
            classroom,
            session: {
                id: sessionId,
                exitTicketEnabled: session.exitTicketEnabled || false
            }
        };

    } catch (error) {
        console.error('=== Check-in Validation Error ===', error);
        if (error.message) {
            throw error;
        }
        throw new Error('เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
};

// ============================================
// Grade Categories
// ============================================

export const createGradeCategory = async (classroomId, name, maxScore) => {
    console.log('📊 createGradeCategory:', { classroomId, name, maxScore });

    // Get current max order
    const categories = await getGradeCategories(classroomId);
    const maxOrder = categories.length > 0
        ? Math.max(...categories.map(c => c.order || 0)) + 1
        : 0;

    const docRef = await addDoc(collection(db, 'grades_categories'), {
        classroomId,
        name,
        maxScore: Number(maxScore) || 0,
        isPublished: false,
        order: maxOrder,
        createdAt: serverTimestamp()
    });

    console.log('📊 createGradeCategory: Created', docRef.id);
    return docRef.id;
};

export const getGradeCategories = async (classroomId) => {
    console.log('📊 getGradeCategories:', classroomId);
    try {
        const q = query(
            collection(db, 'grades_categories'),
            where('classroomId', '==', classroomId)
        );
        const snapshot = await getDocs(q);
        const categories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort by order
        categories.sort((a, b) => (a.order || 0) - (b.order || 0));

        console.log('📊 getGradeCategories: Found', categories.length);
        return categories;
    } catch (error) {
        console.error('📊 getGradeCategories: Error', error);
        return [];
    }
};

export const updateGradeCategory = async (categoryId, data) => {
    console.log('📊 updateGradeCategory:', categoryId, data);
    const docRef = doc(db, 'grades_categories', categoryId);
    await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
    });
};

export const deleteGradeCategory = async (categoryId) => {
    console.log('📊 deleteGradeCategory:', categoryId);

    // Also delete all grades in this category
    const gradesQuery = query(
        collection(db, 'grades'),
        where('categoryId', '==', categoryId)
    );
    const snapshot = await getDocs(gradesQuery);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);

    // Delete the category
    const docRef = doc(db, 'grades_categories', categoryId);
    await deleteDoc(docRef);

    console.log('📊 deleteGradeCategory: Deleted with', snapshot.size, 'grades');
};

// ============================================
// Grades
// ============================================

export const saveGrades = async (classroomId, categoryId, gradesArray, teacherEmail) => {
    console.log('📊 saveGrades:', { classroomId, categoryId, count: gradesArray.length });

    const results = { saved: 0, updated: 0, errors: [] };

    for (const grade of gradesArray) {
        try {
            // Check if grade already exists for this student + category
            const existingQuery = query(
                collection(db, 'grades'),
                where('categoryId', '==', categoryId),
                where('studentId', '==', grade.studentId)
            );
            const existing = await getDocs(existingQuery);

            if (!existing.empty) {
                // Update existing
                const docRef = existing.docs[0].ref;
                await updateDoc(docRef, {
                    score: Number(grade.score) || 0,
                    feedback: grade.feedback || '',
                    studentName: grade.studentName || '',
                    studentEmail: grade.studentEmail || '',
                    updatedAt: serverTimestamp(),
                    updatedBy: teacherEmail
                });
                results.updated++;
            } else {
                // Create new
                await addDoc(collection(db, 'grades'), {
                    classroomId,
                    categoryId,
                    studentId: grade.studentId,
                    studentEmail: grade.studentEmail?.toLowerCase() || '',
                    studentName: grade.studentName || '',
                    score: Number(grade.score) || 0,
                    feedback: grade.feedback || '',
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    updatedBy: teacherEmail
                });
                results.saved++;
            }
        } catch (error) {
            console.error('Error saving grade for', grade.studentId, error);
            results.errors.push({ studentId: grade.studentId, error: error.message });
        }
    }

    console.log('📊 saveGrades: Results', results);
    return results;
};

export const getClassroomGrades = async (classroomId) => {
    console.log('📊 getClassroomGrades:', classroomId);
    try {
        const q = query(
            collection(db, 'grades'),
            where('classroomId', '==', classroomId)
        );
        const snapshot = await getDocs(q);
        const grades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log('📊 getClassroomGrades: Found', grades.length);
        return grades;
    } catch (error) {
        console.error('📊 getClassroomGrades: Error', error);
        return [];
    }
};

export const getStudentGrades = async (studentEmail) => {
    console.log('📊 getStudentGrades:', studentEmail);
    try {
        const normalizedEmail = studentEmail.toLowerCase();

        // Step 1: Find all classrooms this student is enrolled in
        const studentsQuery = query(
            collection(db, 'students'),
            where('email', '==', normalizedEmail)
        );
        const studentsSnapshot = await getDocs(studentsQuery);
        const enrolledClassroomIds = studentsSnapshot.docs.map(doc => doc.data().classroomId);

        console.log('📊 Student enrolled in classrooms:', enrolledClassroomIds);

        if (enrolledClassroomIds.length === 0) {
            return [];
        }

        // Step 2: Get all grades for this student
        const gradesQuery = query(
            collection(db, 'grades'),
            where('studentEmail', '==', normalizedEmail)
        );
        const gradesSnapshot = await getDocs(gradesQuery);
        const allGrades = gradesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Step 3: Get all published categories for enrolled classrooms
        const categoriesSnapshot = await getDocs(collection(db, 'grades_categories'));
        const allCategories = categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Step 4: Group by classroom and include ALL published categories with score = null if no grade exists
        const result = [];

        for (const classroomId of enrolledClassroomIds) {
            // Get published categories for this classroom
            const publishedCategories = allCategories.filter(
                cat => cat.classroomId === classroomId && cat.isPublished === true
            );

            if (publishedCategories.length === 0) {
                continue; // Skip classrooms with no published categories
            }

            // Sort categories by order
            publishedCategories.sort((a, b) => (a.order || 0) - (b.order || 0));

            const grades = [];
            for (const category of publishedCategories) {
                // Find existing grade for this category
                const existingGrade = allGrades.find(g => g.categoryId === category.id);

                grades.push({
                    categoryId: category.id,
                    categoryName: category.name,
                    maxScore: category.maxScore || 0,
                    score: existingGrade ? existingGrade.score : null, // null = no grade (N/A)
                    feedback: existingGrade?.feedback || null,
                    gradeId: existingGrade?.id || null
                });
            }

            // Get classroom name
            let classroomName = '';
            try {
                const classroomDoc = await getDoc(doc(db, 'classrooms', classroomId));
                if (classroomDoc.exists()) {
                    classroomName = classroomDoc.data().name || '';
                }
            } catch (e) {
                console.log('Could not get classroom name:', e);
            }

            result.push({
                classroomId,
                classroomName,
                grades
            });
        }

        console.log('📊 getStudentGrades: Result', result.length, 'classrooms');
        return result;
    } catch (error) {
        console.error('📊 getStudentGrades: Error', error);
        return [];
    }
};

export const updateGrade = async (gradeId, score, teacherEmail, feedback = null) => {
    console.log('📊 updateGrade:', gradeId, score);
    const docRef = doc(db, 'grades', gradeId);
    const updateData = {
        score: Number(score) || 0,
        updatedAt: serverTimestamp(),
        updatedBy: teacherEmail
    };
    // Only update feedback if provided (not null)
    if (feedback !== null) {
        updateData.feedback = feedback;
    }
    await updateDoc(docRef, updateData);
};

// Update only feedback for a grade
export const updateGradeFeedback = async (gradeId, feedback, teacherEmail) => {
    console.log('📊 updateGradeFeedback:', gradeId, feedback);
    const docRef = doc(db, 'grades', gradeId);
    await updateDoc(docRef, {
        feedback: feedback || '',
        updatedAt: serverTimestamp(),
        updatedBy: teacherEmail
    });
};

export const deleteGrade = async (gradeId) => {
    console.log('📊 deleteGrade:', gradeId);
    const docRef = doc(db, 'grades', gradeId);
    await deleteDoc(docRef);
};

// ============================================
// Exit Ticket Functions
// ============================================

// Check if exit ticket is still open for a session
export const isExitTicketOpen = (session) => {
    if (!session) return false;
    // Must be enabled and not manually closed
    if (!session.exitTicketEnabled || session.exitTicketClosedManually) return false;
    // Check deadline
    if (session.exitTicketDeadline) {
        const deadline = session.exitTicketDeadline.toDate?.() || new Date(session.exitTicketDeadline);
        if (new Date() > deadline) return false;
    }
    return true;
};

// Close exit ticket manually (teacher action)
export const closeSessionExitTicket = async (sessionId) => {
    console.log('🎫 closeSessionExitTicket:', sessionId);
    const docRef = doc(db, 'sessions', sessionId);
    await updateDoc(docRef, {
        exitTicketClosedManually: true
    });
};

// Legacy toggle function - now just calls close
export const toggleSessionExitTicket = async (sessionId, enabled) => {
    console.log('🎫 toggleSessionExitTicket:', sessionId, enabled);
    const docRef = doc(db, 'sessions', sessionId);
    if (!enabled) {
        await updateDoc(docRef, { exitTicketClosedManually: true });
    } else {
        // Reopen with new 24hr deadline
        const newDeadline = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
        await updateDoc(docRef, {
            exitTicketClosedManually: false,
            exitTicketEnabled: true,
            exitTicketDeadline: newDeadline
        });
    }
};

// Submit exit ticket from student
export const submitExitTicket = async (sessionId, classroomId, studentData, rating, reason, keyTakeaway) => {
    console.log('🎫 submitExitTicket:', { sessionId, studentId: studentData.studentId, rating });
    try {
        // Check if already submitted
        const existingQuery = query(
            collection(db, 'exit_tickets'),
            where('sessionId', '==', sessionId),
            where('studentEmail', '==', studentData.email?.toLowerCase() || '')
        );
        const existing = await getDocs(existingQuery);

        if (!existing.empty) {
            throw new Error('คุณส่ง Exit Ticket ไปแล้ว');
        }

        const docRef = await addDoc(collection(db, 'exit_tickets'), {
            sessionId,
            classroomId: classroomId || '',
            studentId: studentData.studentId || '',
            studentEmail: studentData.email?.toLowerCase() || '',
            studentName: studentData.name || '',
            rating: Number(rating),
            reason: reason || '',
            keyTakeaway: keyTakeaway || '',
            createdAt: serverTimestamp()
        });

        console.log('🎫 Exit ticket submitted:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('🎫 submitExitTicket error:', error);
        throw error;
    }
};

// Check if student already submitted exit ticket
export const getExitTicketByStudent = async (sessionId, studentEmail) => {
    console.log('🎫 getExitTicketByStudent:', sessionId, studentEmail);
    try {
        const q = query(
            collection(db, 'exit_tickets'),
            where('sessionId', '==', sessionId),
            where('studentEmail', '==', studentEmail.toLowerCase())
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            return null;
        }
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    } catch (error) {
        console.error('🎫 getExitTicketByStudent error:', error);
        return null;
    }
};

// Get all exit tickets for a session (for teacher view)
export const getSessionExitTickets = async (sessionId) => {
    console.log('🎫 getSessionExitTickets:', sessionId);
    try {
        const q = query(
            collection(db, 'exit_tickets'),
            where('sessionId', '==', sessionId)
        );
        const snapshot = await getDocs(q);
        const tickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort by createdAt descending in JS
        tickets.sort((a, b) => {
            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date(0);
            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date(0);
            return dateB - dateA;
        });
        console.log('🎫 Found', tickets.length, 'exit tickets');
        return tickets;
    } catch (error) {
        console.error('🎫 getSessionExitTickets error:', error);
        return [];
    }
};

// Get exit ticket stats for a session
export const getExitTicketStats = async (sessionId) => {
    console.log('🎫 getExitTicketStats:', sessionId);
    try {
        const tickets = await getSessionExitTickets(sessionId);
        if (tickets.length === 0) {
            return { count: 0, avgRating: 0 };
        }
        const totalRating = tickets.reduce((sum, t) => sum + (t.rating || 0), 0);
        return {
            count: tickets.length,
            avgRating: (totalRating / tickets.length).toFixed(1)
        };
    } catch (error) {
        console.error('🎫 getExitTicketStats error:', error);
        return { count: 0, avgRating: 0 };
    }
};
