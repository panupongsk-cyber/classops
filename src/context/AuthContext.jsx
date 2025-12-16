import { createContext, useContext, useState, useEffect } from 'react';
import {
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
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
    const [userRole, setUserRole] = useState(null); // actual role from DB
    const [activeRole, setActiveRole] = useState(null); // role user is currently viewing as
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
                    setActiveRole('admin'); // default to admin view
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
                        setActiveRole('teacher');
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
                        setActiveRole('student');
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

                // Not found in students collection - set as pending (let check-in validate)
                console.log('⚠️ User not pre-registered, allowing as pending');
                setUserRole('student'); // Treat as student, let server validate
                setActiveRole('student');
                setUser({
                    ...firebaseUser,
                    role: 'student',
                    registered: false
                });
                setAuthError(null);
                setLoading(false);

            } else {
                console.log('🔐 No user logged in');
                setUser(null);
                setUserRole(null);
                setActiveRole(null);
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

    // Switch role view (for admin to view as teacher)
    const switchRole = (role) => {
        // Only admin can switch roles
        if (userRole === 'admin') {
            setActiveRole(role);
        }
    };

    // Reset to original role
    const resetRole = () => {
        setActiveRole(userRole);
    };

    // Email/Password Sign-in
    const signInWithEmail = async (email, password) => {
        console.log('🔐 Starting Email sign-in...', email);
        setAuthError(null);
        try {
            const result = await signInWithEmailAndPassword(auth, email, password);
            console.log('🔐 Email sign-in success:', result.user.email);
            return result.user;
        } catch (error) {
            console.error('❌ Email sign-in failed:', error.code, error.message);
            // Try to create user if not exists (Firebase returns different error codes)
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                try {
                    console.log('🔐 User not found, creating...', email);
                    const result = await createUserWithEmailAndPassword(auth, email, password);
                    console.log('🔐 User created:', result.user.email);
                    return result.user;
                } catch (createError) {
                    console.error('❌ Create user failed:', createError.code, createError.message);
                    // If email already exists, it means wrong password
                    if (createError.code === 'auth/email-already-in-use') {
                        throw { code: 'auth/wrong-password', message: 'รหัสผ่านไม่ถูกต้อง' };
                    }
                    throw createError;
                }
            }
            throw error;
        }
    };

    const value = {
        user,
        userRole,      // actual role from DB
        activeRole,    // role currently viewing as
        loading,
        authError,
        signInWithGoogle,
        signInWithEmail,
        logout,
        clearError,
        switchRole,
        resetRole,
        isAdmin: userRole === 'admin',
        isTeacher: userRole === 'teacher' || (userRole === 'admin' && activeRole === 'teacher'),
        isStudent: userRole === 'student',
        canSwitchRole: userRole === 'admin'
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
