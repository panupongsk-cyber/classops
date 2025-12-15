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

    const sessionData = {
        classroomId,
        activeToken: token,
        activeEmoji: emojiSequence,
        tokenExpiry: expiry,
        qrInterval,
        gracePeriod,
        requireGPS,
        isActive: true,
        createdAt: serverTimestamp()
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
        tokenUsed: token,
        userAgent: metadata.userAgent || '',
        ipAddress: metadata.ipAddress || '',
        distanceFromTeacher: metadata.distanceFromTeacher || null,
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

// Delete attendance record
export const deleteAttendance = async (attendanceId) => {
    const docRef = doc(db, 'attendance', attendanceId);
    await deleteDoc(docRef);
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
            classroom
        };

    } catch (error) {
        console.error('=== Check-in Validation Error ===', error);
        if (error.message) {
            throw error;
        }
        throw new Error('เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
};
