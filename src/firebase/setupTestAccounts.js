/**
 * Setup script to create test accounts in Firestore
 * Run this once to register test users
 */

import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';

const TEST_TEACHER = {
    email: 'teacher@test.com',
    name: 'Test Teacher'
};

const TEST_STUDENT = {
    email: 'student@test.com',
    name: 'Test Student',
    studentId: '99000001'
};

async function checkAndAddTeacher() {
    console.log('Checking teacher...');
    const q = query(
        collection(db, 'teachers'),
        where('email', '==', TEST_TEACHER.email)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        console.log('Adding test teacher...');
        await addDoc(collection(db, 'teachers'), {
            email: TEST_TEACHER.email,
            name: TEST_TEACHER.name,
            createdAt: new Date().toISOString()
        });
        console.log('✅ Test teacher added');
    } else {
        console.log('✅ Test teacher already exists');
    }
}

async function checkAndAddStudent(classroomId) {
    console.log('Checking student...');
    const q = query(
        collection(db, 'students'),
        where('email', '==', TEST_STUDENT.email)
    );
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        console.log('Adding test student...');
        await addDoc(collection(db, 'students'), {
            email: TEST_STUDENT.email,
            name: TEST_STUDENT.name,
            studentId: TEST_STUDENT.studentId,
            classroomId: classroomId || 'test-classroom',
            createdAt: new Date().toISOString()
        });
        console.log('✅ Test student added');
    } else {
        console.log('✅ Test student already exists');
    }
}

export async function setupTestAccounts(classroomId) {
    try {
        await checkAndAddTeacher();
        await checkAndAddStudent(classroomId);
        console.log('🎉 Test accounts setup complete!');
        return { success: true };
    } catch (error) {
        console.error('❌ Setup failed:', error);
        return { success: false, error: error.message };
    }
}

// Can also call directly if you import this module
export { TEST_TEACHER, TEST_STUDENT };
