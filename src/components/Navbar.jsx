import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const QRIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
);

const DashboardIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
    </svg>
);

const ClassroomIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
);

const UsersIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const ScanIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <line x1="7" x2="17" y1="12" y2="12" />
    </svg>
);

const HistoryIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
    </svg>
);

// Bar chart icon for Grades pages
const GradesIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" x2="18" y1="20" y2="10" />
        <line x1="12" x2="12" y1="20" y2="4" />
        <line x1="6" x2="6" y1="20" y2="14" />
    </svg>
);

const LogoutIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
);

const ShieldIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const GroupIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 21a8 8 0 0 0-16 0" />
        <circle cx="10" cy="8" r="5" />
        <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </svg>
);

export default function Navbar() {
    const { user, userRole, activeRole, switchRole, canSwitchRole, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

    const adminNavItems = [
        { path: '/admin', icon: <DashboardIcon />, label: 'Admin', exact: true },
        { path: '/admin/teachers', icon: <UsersIcon />, label: 'อาจารย์' },
        { path: '/teacher', icon: <DashboardIcon />, label: 'หน้าแรก', exact: true },
    ];

    // Teacher navigation items
    const teacherNavItems = [
        { path: '/teacher', icon: <DashboardIcon />, label: 'รายวิชา', exact: true },
        { path: '/teacher/settings', icon: <SettingsIcon />, label: 'ตั้งค่า' },
    ];

    // Student navigation items
    const studentNavItems = [
        { path: '/student', icon: <DashboardIcon />, label: 'หน้าแรก', exact: true },
    ];

    // Select nav items based on role
    const navItems = userRole === 'admin'
        ? adminNavItems
        : userRole === 'teacher'
            ? teacherNavItems
            : studentNavItems;

    // Get home path based on role
    const homePath = userRole === 'admin'
        ? '/admin'
        : userRole === 'teacher'
            ? '/teacher'
            : '/student';

    // Get role badge
    const getRoleBadge = () => {
        if (userRole === 'admin') {
            return (
                <span style={{
                    fontSize: '0.75rem',
                    background: activeRole === 'admin' ? 'var(--error)' : 'var(--primary)',
                    padding: '0.1rem 0.4rem',
                    borderRadius: 'var(--radius-full)',
                    marginLeft: '0.5rem'
                }}>
                    {activeRole === 'admin' ? 'Admin' : 'Teacher View'}
                </span>
            );
        }
        return null;
    };

    // Handle role switch
    const handleRoleSwitch = () => {
        if (activeRole === 'admin') {
            switchRole('teacher');
            navigate('/teacher');
        } else {
            switchRole('admin');
            navigate('/admin');
        }
    };

    const isInsideHub = location.pathname.includes('/class/');

    if (!user) return null;

    return (
        <nav className="navbar">
            <div className="container navbar-content">
                <div className="flex items-center gap-md">
                    {isInsideHub && (
                        <button 
                            onClick={() => navigate(homePath)} 
                            className="btn-text" 
                            style={{ padding: '0.5rem', marginRight: '0.5rem' }}
                            title="กลับไปหน้าหลัก"
                        >
                            🏠
                        </button>
                    )}
                    <Link to={homePath} className="navbar-brand">
                        {userRole === 'admin' ? <ShieldIcon /> : <QRIcon />}
                        <span>ClassOps</span>
                        {getRoleBadge()}
                    </Link>
                </div>

                <div className="navbar-nav">
                    {navItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`nav-link ${item.exact ? (location.pathname === item.path ? 'active' : '') : (isActive(item.path) ? 'active' : '')}`}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </Link>
                    ))}

                    {/* Role Switch Button (Admin only) */}
                    {canSwitchRole && (
                        <button
                            onClick={handleRoleSwitch}
                            className="nav-link"
                            style={{
                                background: 'none',
                                border: '1px solid var(--border-color)',
                                cursor: 'pointer',
                                borderRadius: 'var(--radius-md)',
                                padding: '0.4rem 0.8rem'
                            }}
                            title={activeRole === 'admin' ? 'Switch to Teacher View' : 'Switch to Admin View'}
                        >
                            🔄
                            <span>{activeRole === 'admin' ? 'Teacher' : 'Admin'}</span>
                        </button>
                    )}

                    {/* User Info */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-sm)',
                        padding: '0.4rem 0.8rem',
                        background: 'var(--bg-glass)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem'
                    }}>
                        {user?.photoURL ? (
                            <img
                                src={user.photoURL}
                                alt=""
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    objectFit: 'cover'
                                }}
                            />
                        ) : (
                            <span style={{ fontSize: '1rem' }}>👤</span>
                        )}
                        <span style={{
                            maxWidth: '120px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {user?.displayName || user?.email?.split('@')[0] || 'User'}
                        </span>
                    </div>

                    <button onClick={handleLogout} className="nav-link" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                        <LogoutIcon />
                        <span>ออก</span>
                    </button>
                </div>
            </div>
        </nav>
    );
}
