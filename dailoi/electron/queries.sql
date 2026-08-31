-- Kiểm tra tất cả users và courses của họ
SELECT 
    u.id as user_id,
    u.username,
    u.is_finish,
    c.course_name,
    uc.progress,
    uc.time as last_update
FROM users u
LEFT JOIN user_courses uc ON u.id = uc.user_id
LEFT JOIN courses c ON uc.course_id = c.id
ORDER BY u.id, c.id;

-- Xem các khóa học chưa hoàn thành
SELECT 
    u.username,
    c.course_name,
    uc.progress,
    uc.time
FROM user_courses uc
JOIN users u ON uc.user_id = u.id
JOIN courses c ON uc.course_id = c.id
WHERE uc.progress < 100
ORDER BY u.id, uc.progress DESC;

-- Xem logs gần đây
SELECT 
    l.id,
    u.username,
    l.action,
    l.timestamp
FROM logs l
JOIN users u ON l.user_id = u.id
ORDER BY l.timestamp DESC
LIMIT 50;

-- Thống kê tiến độ theo user
SELECT 
    u.username,
    COUNT(uc.id) as total_courses,
    AVG(uc.progress) as avg_progress,
    SUM(CASE WHEN uc.progress = 100 THEN 1 ELSE 0 END) as completed_courses
FROM users u
LEFT JOIN user_courses uc ON u.id = uc.user_id
GROUP BY u.id, u.username;

-- Xóa tất cả logs cũ (nếu cần)
-- DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '7 days';

-- Reset tiến độ của một user (nếu cần)
-- UPDATE user_courses SET progress = 0 WHERE user_id = 1;

-- Thêm course cho user
-- INSERT INTO user_courses (user_id, course_id, progress, time)
-- VALUES (1, 1, 0, CURRENT_TIMESTAMP)
-- ON CONFLICT (user_id, course_id) DO NOTHING;
