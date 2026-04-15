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
        if (!classroomId) return;
        
        const unsubscribe = getPosts(classroomId, (data) => {
            setPosts(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [classroomId]);

    if (loading) {
        return (
            <div className="text-center py-xl">
                <p className="text-muted">กำลังโหลดฟีด...</p>
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
