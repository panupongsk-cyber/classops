import { createContext, useContext, useState, useEffect } from 'react';
import {
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/firebase';
import { isAdmin, getAllowedTeacherByEmail, findStudentByEmail } from '../firebase/firestore';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState(null);

    useEffect(() => {
        console.log('🔐 Setting up auth state listener...');

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            console.log('🔐 Auth state changed:', firebaseUser?.email || 'null');

            if (firebaseUser) {
                const email = firebaseUser.email?.toLowerCase();
                console.log('🔐 Processing user:', email);

                // Check if admin - SET STATE IMMEDIATELY, then save in background
                if (isAdmin(email)) {
                    console.log('✅ User is ADMIN');

                    // Set state FIRST (don't wait for Firestore)
                    setUserRole('admin');
                    setUser({
                        ...firebaseUser,
                        role: 'admin',
                        displayName: firebaseUser.displayName
                    });
                    setAuthError(null);
                    setLoading(false);

                    // Save to Firestore in background (fire and forget)
                    setDoc(doc(db, 'users', firebaseUser.uid), {
                        email: firebaseUser.email,
                        displayName: firebaseUser.displayName,
                        role: 'admin',
                        lastLogin: new Date().toISOString()
                    }, { merge: true })
                        .then(() => console.log('✅ Admin user doc saved'))
                        .catch(e => console.error('⚠️ Failed to save admin user doc:', e));

                    return;
                }

                // Check if allowed teacher
                console.log('🔍 Checking if allowed teacher...');
                try {
                    const teacherData = await getAllowedTeacherByEmail(email);
                    console.log('🔍 Teacher data:', teacherData);

                    if (teacherData) {
                        console.log('✅ User is TEACHER');

                        // Set state FIRST
                        setUserRole('teacher');
                        setUser({
                            ...firebaseUser,
                            role: 'teacher',
                            displayName: teacherData.name || firebaseUser.displayName
                        });
                        setAuthError(null);
                        setLoading(false);

                        // Save to Firestore in background
                        setDoc(doc(db, 'users', firebaseUser.uid), {
                            email: firebaseUser.email,
                            displayName: teacherData.name || firebaseUser.displayName,
                            role: 'teacher',
                            lastLogin: new Date().toISOString()
                        }, { merge: true })
                            .then(() => console.log('✅ Teacher user doc saved'))
                            .catch(e => console.error('⚠️ Failed to save teacher user doc:', e));

                        return;
                    }
                } catch (e) {
                    console.error('⚠️ Error checking teacher:', e);
                }

                // Check if student in students collection
                console.log('🔍 Checking if student in students collection...');
                try {
                    const studentData = await findStudentByEmail(email);

                    if (studentData) {
                        console.log('✅ User is STUDENT');

                        setUserRole('student');
                        setUser({
                            ...firebaseUser,
                            role: 'student',
                            displayName: studentData.name || firebaseUser.displayName,
                            studentId: studentData.studentId,
                            classroomId: studentData.classroomId
                        });
                        setAuthError(null);
                        setLoading(false);

                        // Save to users collection in background
                        setDoc(doc(db, 'users', firebaseUser.uid), {
                            email: firebaseUser.email,
                            displayName: studentData.name || firebaseUser.displayName,
                            role: 'student',
                            studentId: studentData.studentId,
                            lastLogin: new Date().toISOString()
                        }, { merge: true })
                            .then(() => console.log('✅ Student user doc saved'))
                            .catch(e => console.error('⚠️ Failed to save student user doc:', e));

                        return;
                    }
                } catch (e) {
                    console.error('⚠️ Error checking student:', e);
                }

                // Not authorized
                console.log('❌ User NOT FOUND in system');
                setAuthError('ไม่พบรายชื่อในระบบ กรุณาติดต่อผู้ดูแลระบบ');
                setUser(null);
                setUserRole(null);
                setLoading(false);

                // Sign out in background
                signOut(auth).catch(e => console.error('Sign out error:', e));

            } else {
                console.log('🔐 No user logged in');
                setUser(null);
                setUserRole(null);
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, []);

    // Google Sign-in
    const signInWithGoogle = async () => {
        console.log('🔐 Starting Google sign-in...');
        setAuthError(null);
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            console.log('🔐 Google sign-in success:', result.user.email);
            return result.user;
        } catch (error) {
            console.error('❌ Google sign-in failed:', error);
            throw error;
        }
    };

    // Logout
    const logout = async () => {
        console.log('🔐 Logging out...');
        setAuthError(null);
        await signOut(auth);
    };

    // Clear error
    const clearError = () => {
        setAuthError(null);
    };

    const value = {
        user,
        userRole,
        loading,
        authError,
        signInWithGoogle,
        logout,
        clearError,
        isAdmin: userRole === 'admin',
        isTeacher: userRole === 'teacher',
        isStudent: userRole === 'student'
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
