import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createPost } from '../../firebase/firestore';

export default function CreatePost({ classroomId }) {
    const { user } = useAuth();
    const [content, setContent] = useState('');
    const [type, setType] = useState('announcement');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showOptions, setShowOptions] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!content.trim()) return;

        setIsSubmitting(true);
        try {
            await createPost(classroomId, {
                type,
                content,
                authorId: user.uid,
                authorName: user.displayName || user.email,
                metadata: {}
            });
            setContent('');
            setShowOptions(false);
        } catch (error) {
            console.error('Failed to create post:', error);
            alert('โพสต์ไม่สำเร็จ');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="card mb-lg">
            <form onSubmit={handleSubmit}>
                <textarea
                    className="form-input mb-sm"
                    placeholder="ประกาศอะไรบางอย่างให้ชั้นเรียนของคุณ..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onFocus={() => setShowOptions(true)}
                    rows={showOptions ? 3 : 1}
                    style={{ resize: 'none', border: 'none', background: 'transparent', color: 'inherit' }}
                />
                
                {showOptions && (
                    <div className="flex justify-between items-center border-t pt-sm">
                        <div className="flex gap-xs">
                            <button 
                                type="button" 
                                className={`btn-pill ${type === 'announcement' ? 'active' : ''}`}
                                onClick={() => setType('announcement')}
                            >
                                📢 ประกาศ
                            </button>
                            <button 
                                type="button" 
                                className={`btn-pill ${type === 'resource' ? 'active' : ''}`}
                                onClick={() => setType('resource')}
                            >
                                📁 ไฟล์
                            </button>
                            <button 
                                type="button" 
                                className={`btn-pill ${type === 'assignment' ? 'active' : ''}`}
                                onClick={() => setType('assignment')}
                            >
                                📝 งาน
                            </button>
                            <button 
                                type="button" 
                                className={`btn-pill ${type === 'quiz' ? 'active' : ''}`}
                                onClick={() => setType('quiz')}
                                title="จะเชื่อมต่อกับ OmniQuizOps เร็วๆ นี้"
                            >
                                ⚡ Quiz
                            </button>
                        </div>
                        <div className="flex gap-sm">
                            <button 
                                type="button" 
                                className="btn-text"
                                onClick={() => {
                                    setShowOptions(false);
                                    setContent('');
                                }}
                            >
                                ยกเลิก
                            </button>
                            <button 
                                type="submit" 
                                className="btn btn-primary"
                                disabled={isSubmitting || !content.trim()}
                            >
                                {isSubmitting ? 'กำลังโพสต์...' : 'โพสต์'}
                            </button>
                        </div>
                    </div>
                )}
            </form>
        </div>
    );
}
