import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getPosts } from '../../firebase/firestore';
import PostCard from './PostCard';
import CreatePost from './CreatePost';

export default function Feed({ classroomId }) {
    const { userRole } = useAuth();
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!classroomId) {
            setLoading(false);
            return;
        }
        
        setLoading(true);
        const unsubscribe = getPosts(classroomId, (data) => {
            setPosts(data);
            setLoading(false);
        }, (error) => {
            console.error("Feed subscription error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [classroomId]);

    if (loading) {
        return (
            <div className="text-center py-xl card">
                <div className="spinner mb-md"></div>
                <p className="text-muted">กำลังโหลดฟีดชั้นเรียน...</p>
            </div>
        );
    }

    if (!classroomId) {
        return (
            <div className="card text-center py-xl">
                <p className="text-muted">กรุณาเลือกชั้นเรียนเพื่อดูฟีด</p>
            </div>
        );
    }

    return (
        <div className="feed-container">
            {(userRole === 'admin' || userRole === 'teacher') && (
                <CreatePost classroomId={classroomId} />
            )}

            <div className="posts-list">
                {posts.length === 0 ? (
                    <div className="card text-center py-xl">
                        <p className="text-muted">ยังไม่มีโพสต์ในตอนนี้</p>
                    </div>
                ) : (
                    posts.map(post => (
                        <PostCard key={post.id} post={post} classroomId={classroomId} />
                    ))
                )}
            </div>
        </div>
    );
}
