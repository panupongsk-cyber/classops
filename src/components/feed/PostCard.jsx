import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { deletePost } from '../../firebase/firestore';

const AnnouncementIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>
);

const ResourceIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
);

const AssignmentIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
    </svg>
);

const QuizIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
);

const CodeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
    </svg>
);

export default function PostCard({ post, classroomId }) {
    const { userRole } = useAuth();
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (!window.confirm('ยืนยันการลบโพสต์นี้?')) return;
        setIsDeleting(true);
        try {
            await deletePost(classroomId, post.id);
        } catch (error) {
            console.error('Failed to delete post:', error);
            alert('ลบไม่สำเร็จ');
            setIsDeleting(false);
        }
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return '';
        const date = timestamp.toDate();
        return new Intl.DateTimeFormat('th-TH', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    };

    const renderIcon = () => {
        switch (post.type) {
            case 'announcement': return <AnnouncementIcon />;
            case 'resource': return <ResourceIcon />;
            case 'assignment': return <AssignmentIcon />;
            case 'quiz': return <QuizIcon />;
            case 'code': return <CodeIcon />;
            default: return null;
        }
    };

    return (
        <div className={`card mb-md ${isDeleting ? 'opacity-50' : ''}`} style={{ borderLeft: `4px solid var(--type-${post.type}-color, #ddd)` }}>
            <div className="flex justify-between items-start mb-sm">
                <div className="flex items-center gap-sm">
                    <div className={`icon-wrapper type-${post.type}`}>
                        {renderIcon()}
                    </div>
                    <div>
                        <div className="font-bold text-sm">{post.authorName || 'Teacher'}</div>
                        <div className="text-xs text-muted">{formatDate(post.createdAt)}</div>
                    </div>
                </div>
                {userRole === 'admin' || userRole === 'teacher' ? (
                    <button onClick={handleDelete} className="btn-icon text-danger" title="ลบโพสต์">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                ) : null}
            </div>

            <div className="post-content mb-md">
                <p style={{ whiteSpace: 'pre-wrap' }}>{post.content}</p>
            </div>

            {post.metadata?.attachments?.length > 0 && (
                <div className="attachments-grid mb-md">
                    {post.metadata.attachments.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="attachment-item">
                            <ResourceIcon />
                            <span>ไฟล์แนบ {i + 1}</span>
                        </a>
                    ))}
                </div>
            )}

            {post.type === 'quiz' && (
                <button className="btn btn-primary btn-full flex items-center justify-center gap-sm">
                    <QuizIcon />
                    เข้าร่วม Quiz: {post.metadata?.quizTitle || 'ทำแบบทดสอบ'}
                </button>
            )}

            {post.type === 'code' && (
                <button className="btn btn-secondary btn-full flex items-center justify-center gap-sm">
                    <CodeIcon />
                    เปิด Editor: {post.metadata?.taskTitle || 'เขียนโปรแกรม'}
                </button>
            )}

            <div className="flex items-center gap-lg border-t pt-sm mt-sm">
                <button className="btn-text text-sm flex items-center gap-xs">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                    <span>{post.interactions?.likes?.length || 0} ถูกใจ</span>
                </button>
                <button className="btn-text text-sm flex items-center gap-xs">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    <span>{post.interactions?.commentsCount || 0} ความคิดเห็น</span>
                </button>
            </div>
        </div>
    );
}
