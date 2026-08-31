const { ipcRenderer } = require('electron');

let users = [];
let courses = [];
let userCourses = new Map();

// Tab management
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        // Update active tab button
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');
        
        // Load data for the selected tab
        if (tabName === 'logs') {
            loadLogs();
        }
    });
});

// Initialize app
async function init() {
    await loadUsers();
    await loadCourses();
    setupEventListeners();
}

function setupEventListeners() {
    // User management
    document.getElementById('addUserBtn').addEventListener('click', () => {
        document.getElementById('addUserForm').style.display = 'block';
    });
    
    document.getElementById('cancelUserBtn').addEventListener('click', () => {
        document.getElementById('addUserForm').style.display = 'none';
        document.getElementById('userForm').reset();
    });
    
    document.getElementById('userForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createUser();
    });
    
    // Course management
    document.getElementById('addCourseBtn').addEventListener('click', () => {
        document.getElementById('addCourseForm').style.display = 'block';
    });
    
    document.getElementById('cancelCourseBtn').addEventListener('click', () => {
        document.getElementById('addCourseForm').style.display = 'none';
        document.getElementById('courseForm').reset();
    });
    
    document.getElementById('courseForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createCourse();
    });
    
    // Automation
    document.getElementById('startAllBtn').addEventListener('click', startAllUsers);
    document.getElementById('stopAllBtn').addEventListener('click', stopAllUsers);
    
    // Logs
    document.getElementById('refreshLogsBtn').addEventListener('click', loadLogs);
    document.getElementById('logUserFilter').addEventListener('change', loadLogs);
    
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadUsers();
        loadCourses();
    });
}

// User functions
async function loadUsers() {
    users = await ipcRenderer.invoke('get-users');
    renderUsers();
    renderAutomationList();
    updateLogUserFilter();
}

function renderUsers() {
    const usersList = document.getElementById('usersList');
    
    if (users.length === 0) {
        usersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👤</div>
                <div class="empty-state-text">Chưa có người dùng nào. Hãy thêm người dùng mới!</div>
            </div>
        `;
        return;
    }
    
    usersList.innerHTML = users.map(user => `
        <div class="card">
            <div class="card-header">
                <div class="card-title">👤 ${user.username}</div>
                <div class="card-actions">
                    <button class="btn btn-info" onclick="loginUser(${user.id})">🔑 Đăng nhập</button>
                    <button class="btn btn-warning" onclick="syncCourses(${user.id})">🔄 Đồng bộ</button>
                    <button class="btn btn-danger" onclick="deleteUser(${user.id})">🗑️ Xóa</button>
                </div>
            </div>
            <div class="card-body">
                <p><strong>Trạng thái:</strong> ${user.is_finish ? '<span class="badge badge-success">Hoàn thành</span>' : '<span class="badge badge-warning">Đang học</span>'}</p>
            </div>
        </div>
    `).join('');
}

async function createUser() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        await ipcRenderer.invoke('create-user', {
            username,
            password,
            is_finish: false
        });
        
        document.getElementById('addUserForm').style.display = 'none';
        document.getElementById('userForm').reset();
        await loadUsers();
        alert('✅ Tạo người dùng thành công!');
    } catch (error) {
        alert('❌ Lỗi: ' + error.message);
    }
}

async function deleteUser(userId) {
    if (!confirm('Bạn có chắc muốn xóa người dùng này?')) {
        return;
    }
    
    try {
        await ipcRenderer.invoke('delete-user', userId);
        await loadUsers();
        alert('✅ Xóa người dùng thành công!');
    } catch (error) {
        alert('❌ Lỗi: ' + error.message);
    }
}

async function loginUser(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    // Show input dialog for login URL
    showInputDialog('Nhập URL trang đăng nhập', 'https://example.com/login', async (loginUrl) => {
        if (!loginUrl) return;
        
        showProgress('Đăng nhập', 0, 'Đang khởi tạo...');
        
        try {
            const success = await ipcRenderer.invoke('login', {
                userId: user.id,
                username: user.username,
                password: user.password,
                loginUrl: loginUrl,
            });
            
            hideProgress();
            
            if (success) {
                alert('✅ Đăng nhập thành công!');
            } else {
                alert('⚠️ Vui lòng kiểm tra trình duyệt và đăng nhập thủ công nếu cần.');
            }
        } catch (error) {
            hideProgress();
            alert('❌ Lỗi: ' + error.message);
        }
    });
}

async function syncCourses(userId) {
    try {
        const result = await ipcRenderer.invoke('sync-courses', userId);
        if (result.success) {
            alert('✅ ' + result.message);
            await loadCourses();
        } else {
            alert('❌ ' + result.message);
        }
    } catch (error) {
        alert('❌ Lỗi: ' + error.message);
    }
}

// Course functions
async function loadCourses() {
    courses = await ipcRenderer.invoke('get-courses');
    renderCourses();
}

function renderCourses() {
    const coursesList = document.getElementById('coursesList');
    
    if (courses.length === 0) {
        coursesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📚</div>
                <div class="empty-state-text">Chưa có khóa học nào. Hãy thêm khóa học mới!</div>
            </div>
        `;
        return;
    }
    
    coursesList.innerHTML = courses.map(course => `
        <div class="card">
            <div class="card-header">
                <div class="card-title">📚 ${course.course_name}</div>
            </div>
            <div class="card-body">
                <p>${course.description || 'Không có mô tả'}</p>
                <p><strong>Link:</strong> <a href="${course.link}" target="_blank">${course.link}</a></p>
            </div>
        </div>
    `).join('');
}

async function createCourse() {
    const course_name = document.getElementById('courseName').value;
    const description = document.getElementById('courseDescription').value;
    const link = document.getElementById('courseLink').value;
    
    try {
        await ipcRenderer.invoke('create-course', {
            course_name,
            description,
            link
        });
        
        document.getElementById('addCourseForm').style.display = 'none';
        document.getElementById('courseForm').reset();
        await loadCourses();
        alert('✅ Tạo khóa học thành công!');
    } catch (error) {
        alert('❌ Lỗi: ' + error.message);
    }
}

// Automation functions
async function renderAutomationList() {
    const automationList = document.getElementById('automationList');
    
    if (users.length === 0) {
        automationList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🤖</div>
                <div class="empty-state-text">Chưa có người dùng nào để chạy tự động.</div>
            </div>
        `;
        return;
    }
    
    const automationHTML = await Promise.all(users.map(async user => {
        const incompleteCourses = await ipcRenderer.invoke('get-incomplete-courses', user.id);
        
        return `
            <div class="automation-item" id="automation-${user.id}">
                <div class="automation-header">
                    <div class="automation-user">👤 ${user.username}</div>
                    <div class="automation-controls">
                        <button class="btn btn-success" onclick="startUserLearning(${user.id})">▶️ Bắt đầu</button>
                        <button class="btn btn-danger" onclick="stopUserLearning(${user.id})">⏹️ Dừng</button>
                        <button class="btn btn-secondary" onclick="closeBrowser(${user.id})">❌ Đóng trình duyệt</button>
                    </div>
                </div>
                <div class="courses-list" id="courses-${user.id}">
                    ${incompleteCourses.length > 0 ? 
                        incompleteCourses.map(course => `
                            <div class="course-item" id="course-${user.id}-${course.course_id}">
                                <div class="course-name">${course.course_name}</div>
                                <div class="course-progress">Tiến độ: ${course.progress}%</div>
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${course.progress}%"></div>
                                </div>
                            </div>
                        `).join('') 
                        : '<p class="empty-state-text">Không có khóa học chưa hoàn thành</p>'
                    }
                </div>
            </div>
        `;
    }));
    
    automationList.innerHTML = automationHTML.join('');
}

async function startUserLearning(userId) {
    const incompleteCourses = await ipcRenderer.invoke('get-incomplete-courses', userId);
    
    if (incompleteCourses.length === 0) {
        alert('Không có khóa học chưa hoàn thành!');
        return;
    }
    
    for (const course of incompleteCourses) {
        await ipcRenderer.invoke('start-learning', userId, course.course_id);
    }
}

async function stopUserLearning(userId) {
    await ipcRenderer.invoke('stop-learning', userId);
    alert('✅ Đã dừng học!');
}

async function closeBrowser(userId) {
    await ipcRenderer.invoke('close-browser', userId);
    alert('✅ Đã đóng trình duyệt!');
}

async function startAllUsers() {
    if (!confirm('Bạn có chắc muốn chạy tất cả người dùng?')) {
        return;
    }
    
    const userIds = users.map(u => u.id);
    await ipcRenderer.invoke('start-multiple-learning', userIds);
}

async function stopAllUsers() {
    for (const user of users) {
        await ipcRenderer.invoke('stop-learning', user.id);
    }
    alert('✅ Đã dừng tất cả!');
}

// Logs functions
async function loadLogs() {
    const selectedUserId = document.getElementById('logUserFilter').value;
    const userId = selectedUserId ? parseInt(selectedUserId) : undefined;
    
    const logs = await ipcRenderer.invoke('get-logs', userId);
    renderLogs(logs);
}

function renderLogs(logs) {
    const logsList = document.getElementById('logsList');
    
    if (logs.length === 0) {
        logsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">Chưa có nhật ký nào.</div>
            </div>
        `;
        return;
    }
    
    logsList.innerHTML = logs.map(log => {
        const timestamp = new Date(log.timestamp).toLocaleString('vi-VN');
        return `
            <div class="log-item">
                <div class="log-header">
                    <div class="log-user">${log.username || 'User ' + log.user_id}</div>
                    <div class="log-time">${timestamp}</div>
                </div>
                <div class="log-action">${log.action}</div>
            </div>
        `;
    }).join('');
}

function updateLogUserFilter() {
    const logUserFilter = document.getElementById('logUserFilter');
    logUserFilter.innerHTML = '<option value="">Tất cả người dùng</option>' +
        users.map(user => `<option value="${user.id}">${user.username}</option>`).join('');
}

// Progress modal
function showProgress(title, progress, message) {
    const modal = document.getElementById('progressModal');
    const progressTitle = document.getElementById('progressTitle');
    const progressFill = document.getElementById('progressBarFill');
    const progressMessage = document.getElementById('progressMessage');
    
    progressTitle.textContent = title;
    progressFill.style.width = progress + '%';
    progressMessage.textContent = message;
    modal.style.display = 'flex';
}

function hideProgress() {
    document.getElementById('progressModal').style.display = 'none';
}

// Input dialog
function showInputDialog(title, defaultValue, onSubmit) {
    const modal = document.getElementById('progressModal');
    const modalContent = modal.querySelector('.modal-content');
    
    modalContent.innerHTML = `
        <h3>${title}</h3>
        <form id="inputDialogForm">
            <div class="form-group">
                <input type="text" id="inputDialogValue" class="form-control" value="${defaultValue}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; margin: 15px 0;">
            </div>
            <div class="form-actions">
                <button type="submit" class="btn btn-primary">OK</button>
                <button type="button" class="btn btn-secondary" id="inputDialogCancel">Hủy</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
    
    const form = document.getElementById('inputDialogForm');
    const input = document.getElementById('inputDialogValue');
    const cancelBtn = document.getElementById('inputDialogCancel');
    
    input.focus();
    input.select();
    
    form.onsubmit = (e) => {
        e.preventDefault();
        const value = input.value.trim();
        modal.style.display = 'none';
        
        // Restore modal content
        modalContent.innerHTML = `
            <h3 id="progressTitle">Đang xử lý...</h3>
            <div class="progress-bar">
                <div id="progressBarFill" class="progress-fill"></div>
            </div>
            <p id="progressMessage">Đang khởi tạo...</p>
        `;
        
        if (value) {
            onSubmit(value);
        }
    };
    
    cancelBtn.onclick = () => {
        modal.style.display = 'none';
        
        // Restore modal content
        modalContent.innerHTML = `
            <h3 id="progressTitle">Đang xử lý...</h3>
            <div class="progress-bar">
                <div id="progressBarFill" class="progress-fill"></div>
            </div>
            <p id="progressMessage">Đang khởi tạo...</p>
        `;
    };
}

// Listen to progress events
ipcRenderer.on('login-progress', (event, data) => {
    showProgress('Đăng nhập', data.progress, data.message);
    if (data.progress === 100 || data.progress === 0) {
        setTimeout(hideProgress, 2000);
    }
});

ipcRenderer.on('learning-progress', (event, data) => {
    const courseElement = document.getElementById(`course-${data.userId}-${data.courseId}`);
    if (courseElement) {
        const progressBar = courseElement.querySelector('.progress-fill');
        const progressText = courseElement.querySelector('.course-progress');
        
        if (progressBar) {
            progressBar.style.width = data.progress + '%';
        }
        if (progressText) {
            progressText.textContent = `Tiến độ: ${data.progress}% - ${data.message}`;
        }
    }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
