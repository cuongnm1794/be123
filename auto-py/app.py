from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
import uvicorn
import threading

from mouse import click_at, move_to, scroll_at, type_text
from notify import get_notify_config, send_notification
from accounts_client import get_insights, load_profiles_from_seed, log_event
from launch_chrome import DEFAULT_EXT, DEFAULT_PROFILE_BASE, DEFAULT_URL, launch as launch_chrome_profile
from windows import (
    list_student_windows,
    focus_user_window,
    focus_window_at_point,
    arrange_student_windows,
    minimize_user_window,
    stop_all_windows_report,
)

app = FastAPI(title="Auto Click API")

_stop_flag = False
_lock = threading.Lock()


def set_stop():
    global _stop_flag
    with _lock:
        _stop_flag = True


def reset_stop():
    global _stop_flag
    with _lock:
        _stop_flag = False


def get_stop():
    with _lock:
        return _stop_flag


try:
    import keyboard

    keyboard.add_hotkey("ctrl+f8", set_stop)
    keyboard.add_hotkey("ctrl+shift+q", set_stop)
    keyboard.add_hotkey("ctrl+shift+r", reset_stop)
    print("Hotkeys: Ctrl+F8 / Ctrl+Shift+Q = STOP, Ctrl+Shift+R = RESET")
except Exception as e:
    print(f"keyboard hotkeys not available: {e}")


@app.get("/")
def root():
    return {
        "click": "/click?x=-906&y=866",
        "move": "/move?x=-906&y=866",
        "stop": "/stop-all",
        "check": "/check-stop",
        "reset": "/reset-stop",
        "manager": "/manager",
        "dashboard": "/dashboard",
        "launch-chrome": "/launch-chrome?user_id=1",
        "windows": "/windows",
        "focus-window": "/focus-window?user_id=1",
        "arrange-windows": "/arrange-windows",
        "hotkeys": "Ctrl+F8 / Ctrl+Shift+Q = STOP, Ctrl+Shift+R = RESET",
        "type": "/type?x=0&y=0&text=hello",
        "scroll": "/scroll?x=0&y=0&amount=-3",
        "focus-at": "/focus-at?x=0&y=0",
        "notify": "/notify?user_id=1&event=practice_round_complete&practice_round=1&max_rounds=3",
        "notify-config": "/notify-config",
    }


@app.get("/move")
def move(
    x: int = Query(..., description="Toa do X (tu extension)"),
    y: int = Query(..., description="Toa do Y (tu extension)"),
    user_id: int | None = Query(None, description="ID hoc vien (focus fallback)"),
):
    move_to(x, y, user_id=user_id)
    return {"ok": True, "x": x, "y": y}


@app.get("/click")
def click(
    x: int = Query(..., description="Toa do X (tu extension)"),
    y: int = Query(..., description="Toa do Y (tu extension)"),
    user_id: int | None = Query(None, description="ID hoc vien (focus fallback)"),
):
    click_at(x, y, user_id=user_id)
    return {"ok": True, "x": x, "y": y}


@app.get("/scroll")
def scroll_endpoint(
    x: int = Query(..., description="Toa do X (tu extension)"),
    y: int = Query(..., description="Toa do Y (tu extension)"),
    amount: int = Query(..., description="Luong cuon (>0 len, <0 xuong)"),
    user_id: int | None = Query(None, description="ID hoc vien (focus fallback)"),
):
    scroll_at(x, y, amount, user_id=user_id)
    return {"ok": True, "x": x, "y": y, "amount": amount}


@app.get("/type")
def type_endpoint(
    text: str = Query(..., description="Noi dung go"),
    x: int | None = Query(None, description="Toa do X (optional)"),
    y: int | None = Query(None, description="Toa do Y (optional)"),
    clear_first: bool = Query(False, description="Ctrl+A xoa truoc khi go"),
    user_id: int | None = Query(None, description="ID hoc vien (focus fallback)"),
):
    type_text(text, x=x, y=y, clear_first=clear_first, user_id=user_id)
    return {"ok": True, "text_len": len(text)}


@app.get("/type-at-focus")
def type_at_focus_endpoint(
    text: str = Query(..., description="Noi dung go tai vi tri chuot"),
):
    type_text(text)
    return {"ok": True, "text_len": len(text)}


@app.get("/focus-at")
def focus_at_endpoint(
    x: int = Query(..., description="Toa do X man hinh"),
    y: int = Query(..., description="Toa do Y man hinh"),
):
    result = focus_window_at_point(x, y)
    return result


@app.get("/stop-all")
def stop_all():
    set_stop()
    return {"ok": True, "stop": True}


@app.get("/check-stop")
def check_stop():
    return {"stop": get_stop()}


@app.get("/reset-stop")
def reset_stop_endpoint():
    reset_stop()
    return {"ok": True, "stop": False}


# ── Quản lý cửa sổ học viên (đưa lên top để site tính giờ) ──

@app.get("/windows")
def windows_endpoint():
    return stop_all_windows_report()


@app.get("/focus-window")
def focus_window_endpoint(
    user_id: int = Query(..., description="ID học viên (khớp profile user-{id})"),
):
    w = focus_user_window(user_id)
    if not w:
        return {"ok": False, "error": f"Không tìm thấy cửa sổ user {user_id}"}
    return {"ok": True, "user_id": user_id, "title": w["title"]}


@app.get("/arrange-windows")
def arrange_windows_endpoint():
    return arrange_student_windows()


@app.get("/profile-map")
def profile_map_endpoint():
    """Map user_id ↔ CCCD (từ seed/namcaonguyen-users.json)."""
    profiles, default_password = load_profiles_from_seed()
    return {"profiles": profiles, "default_password": default_password}


@app.get("/accounts-insights")
def accounts_insights_endpoint():
    """Tiến độ học viên NCN từ accounts-db (nếu API đang chạy)."""
    return {"insights": get_insights("namcaonguyen")}


@app.get("/launch-chrome")
def launch_chrome_endpoint(
    user_id: int = Query(..., description="ID học viên (profile user-{id})"),
    url: str | None = Query(None, description="URL mở đầu"),
    focus_if_open: bool = Query(True, description="Nếu Chrome đã mở thì focus thay vì mở mới"),
):
    """Mở Chrome NCN + extension theo profile user-{id} (gọi launch_chrome.py)."""
    if focus_if_open:
        existing = focus_user_window(user_id)
        if existing:
            return {
                "ok": True,
                "action": "focused",
                "user_id": user_id,
                "title": existing.get("title"),
            }

    result = launch_chrome_profile(
        user_id,
        url or DEFAULT_URL,
        DEFAULT_PROFILE_BASE,
        DEFAULT_EXT,
    )
    if not result.get("ok"):
        return result
    result["action"] = "launched"
    return result


@app.get("/students")
def students_endpoint():
    """Danh sách học viên + cửa sổ đang mở (cho dashboard)."""
    profiles, default_password = load_profiles_from_seed()
    open_ids = {w["user_id"] for w in list_student_windows()}
    insights = {i["user_id"]: i for i in get_insights("namcaonguyen")}
    students = []
    for p in profiles:
        uid = p["user_id"]
        ins = insights.get(uid, {})
        students.append(
            {
                **p,
                "cccd": p.get("cccd") or p.get("username"),
                "is_open": uid in open_ids,
                "today_hours": ins.get("today_hours", 0),
                "courses": ins.get("courses", []),
                "is_running": ins.get("is_running"),
                "is_finish": ins.get("is_finish"),
            }
        )
    return {"students": students, "default_password": default_password}


@app.get("/minimize-window")
def minimize_window_endpoint(
    user_id: int = Query(..., description="ID học viên"),
):
    ok = minimize_user_window(user_id)
    return {"ok": ok, "user_id": user_id}


@app.get("/notify-config")
def notify_config_endpoint():
    cfg = get_notify_config()
    return {
        "enabled": cfg["enabled"],
        "configured": bool(cfg["bot_token"] and cfg["chat_id"]),
    }


@app.get("/notify")
def notify_endpoint(
    user_id: int = Query(..., description="ID học viên (profile user-{id})"),
    event: str = Query(
        ...,
        description="practice_round_complete | practice_all_complete | devtools_suspicion",
    ),
    user_name: str | None = Query(None, description="Tên hiển thị (optional)"),
    practice_round: int | None = Query(None, description="Lượt vừa xong"),
    max_rounds: int | None = Query(None, description="Tổng số lượt"),
    message: str | None = Query(None, description="Chi tiết thêm"),
    page_url: str | None = Query(None, description="URL trang LMS"),
):
    result = send_notification(
        event,
        user_id=user_id,
        user_name=user_name,
        practice_round=practice_round,
        max_rounds=max_rounds,
        message=message,
        page_url=page_url,
    )
    detail = message or event
    if practice_round is not None and max_rounds is not None:
        detail = f"{event}: luot {practice_round}/{max_rounds}"
    log_event(user_id, detail)
    return result


DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard học viên – Nam Cao Nguyên</title>
<style>
  :root{--bg:#0a0e1a;--card:#141b2d;--border:#1e293b;--text:#e2e8f0;--muted:#64748b;--accent:#f59e0b;--green:#10b981;--red:#ef4444;--blue:#3b82f6}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);padding:24px;max-width:1200px;margin:0 auto}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .toolbar{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center}
  .btn{padding:8px 16px;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:500;text-decoration:none;display:inline-block}
  .btn-ghost{background:var(--card);color:var(--text);border:1px solid var(--border)}
  .btn-green{background:var(--green);color:#fff}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
  .student{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px 16px;cursor:pointer;transition:.15s;position:relative}
  .student:hover{border-color:var(--accent);transform:translateY(-2px)}
  .student.open{border-color:var(--green)}
  .student .num{font-size:32px;font-weight:700;color:var(--accent);line-height:1;margin-bottom:8px}
  .student .name{font-size:16px;font-weight:600;margin-bottom:4px}
  .student .cccd{font-size:11px;color:var(--muted);word-break:break-all}
  .student .badge{position:absolute;top:12px;right:12px;font-size:10px;padding:3px 8px;border-radius:999px;background:#1e293b;color:var(--muted)}
  .student.open .badge{background:rgba(16,185,129,.15);color:var(--green)}
  .student .meta{font-size:11px;color:var(--muted);margin-top:10px;line-height:1.5}
  .student .actions{display:flex;gap:6px;margin-top:12px}
  .student .actions button{flex:1;padding:7px 8px;border:none;border-radius:7px;font-size:11px;cursor:pointer}
  .student .actions .launch{background:var(--blue);color:#fff}
  .student .actions .focus-btn{background:var(--accent);color:#fff}
  .empty{color:var(--muted);text-align:center;padding:48px}
  .toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;z-index:100;background:var(--green);color:#fff;display:none}
  .toast.err{background:var(--red)}
</style>
</head>
<body>
  <h1>Dashboard học viên</h1>
  <div class="sub">Bấm thẻ hoặc <b>Mở Chrome</b> để launch profile <code>user-{id}</code> + extension NCN. Đã mở rồi thì tự focus lên trên.</div>
  <div class="toolbar">
    <button class="btn btn-green" onclick="launchAll()">Mở tất cả</button>
    <button class="btn btn-ghost" onclick="refresh()">Làm mới</button>
    <a class="btn btn-ghost" href="/manager">Quản lý cửa sổ</a>
  </div>
  <div class="grid" id="grid"></div>
  <div class="toast" id="toast"></div>
<script>
const API = '';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
  return res.json();
}

function showToast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function launchUser(id, ev) {
  if (ev) ev.stopPropagation();
  try {
    const r = await fetchJson(`${API}/launch-chrome?user_id=${id}`);
    if (!r.ok) { showToast(r.error || 'Lỗi mở Chrome', true); return; }
    showToast(r.action === 'focused' ? `User ${id} đã mở — đưa lên trên` : `Đã mở Chrome user ${id}`);
    setTimeout(refresh, 600);
  } catch (e) { showToast('Lỗi: ' + e.message, true); }
}

async function focusUser(id, ev) {
  if (ev) ev.stopPropagation();
  try {
    const r = await fetchJson(`${API}/focus-window?user_id=${id}`);
    showToast(r.ok ? `User ${id} lên trên` : (r.error || 'Không thấy cửa sổ'), !r.ok);
  } catch (e) { showToast('Lỗi: ' + e.message, true); }
}

function render(students) {
  const box = document.getElementById('grid');
  if (!students.length) {
    box.innerHTML = '<div class="empty">Chưa có học viên trong seed/namcaonguyen-users.json</div>';
    return;
  }
  box.innerHTML = students.map(s => {
    const hours = (s.today_hours || 0).toFixed(1);
    const openCls = s.is_open ? ' open' : '';
    const badge = s.is_open ? 'Đang mở' : 'Chưa mở';
    return `
    <div class="student${openCls}" onclick="launchUser(${s.user_id})">
      <span class="badge">${badge}</span>
      <div class="num">${s.user_id}</div>
      <div class="name">${escapeHtml(s.name || 'Học viên')}</div>
      <div class="cccd">${escapeHtml(s.cccd || '')}</div>
      <div class="meta">Hôm nay: ${hours}h</div>
      <div class="actions">
        <button class="launch" onclick="launchUser(${s.user_id}, event)">Mở Chrome</button>
        <button class="focus-btn" onclick="focusUser(${s.user_id}, event)">Lên trên</button>
      </div>
    </div>`;
  }).join('');
}

async function refresh() {
  try {
    const data = await fetchJson(`${API}/students`);
    render(data.students || []);
  } catch (e) {
    document.getElementById('grid').innerHTML = `<div class="empty">Lỗi: ${escapeHtml(e.message)}</div>`;
  }
}

async function launchAll() {
  try {
    const data = await fetchJson(`${API}/students`);
    const list = data.students || [];
    for (const s of list) {
      await fetchJson(`${API}/launch-chrome?user_id=${s.user_id}`);
      await new Promise(r => setTimeout(r, 800));
    }
    showToast(`Đã launch ${list.length} profile`);
    setTimeout(refresh, 1000);
  } catch (e) { showToast('Lỗi: ' + e.message, true); }
}

refresh();
setInterval(refresh, 8000);
</script>
</body>
</html>
"""


MANAGER_HTML = r"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quản lý học viên – Nam Cao Nguyên</title>
<style>
  :root{--bg:#0a0e1a;--card:#141b2d;--border:#1e293b;--text:#e2e8f0;--muted:#64748b;--accent:#f59e0b;--green:#10b981;--red:#ef4444}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);padding:24px}
  h1{font-size:20px;margin-bottom:6px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:18px}
  .toolbar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
  .btn{padding:8px 16px;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:500}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-ghost{background:var(--card);color:var(--text);border:1px solid var(--border)}
  .btn-green{background:var(--green);color:#fff}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;cursor:pointer;transition:.15s}
  .card:hover{border-color:var(--accent)}
  .card.active{border-color:var(--green);box-shadow:0 0 0 1px var(--green)}
  .card h3{font-size:15px;margin-bottom:4px}
  .card .meta{font-size:12px;color:var(--muted);margin-bottom:8px;word-break:break-all}
  .card .progress{font-size:12px;margin-top:6px;line-height:1.5}
  .card .progress .ok{color:var(--green)}
  .card .progress .pending{color:var(--accent)}
  .card .actions{display:flex;gap:8px;margin-top:10px}
  .card .actions button{padding:6px 12px;border:none;border-radius:6px;font-size:12px;cursor:pointer}
  .focus{background:var(--accent);color:#fff}
  .min{background:var(--card);color:var(--text);border:1px solid var(--border)}
  .empty{color:var(--muted);text-align:center;padding:40px;font-size:14px}
  .toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;z-index:100;background:var(--green);color:#fff;display:none}
  .toast.err{background:var(--red)}
  .hint{font-size:12px;color:var(--muted);margin-top:14px;line-height:1.6}
</style>
</head>
<body>
  <h1>Quản lý học viên – Nam Cao Nguyên</h1>
  <div class="sub">Bấm vào thẻ học viên để đưa cửa sổ lên trên cùng (site chỉ tính giờ khi cửa sổ ở trên). "Xếp cửa sổ" để thấy hết tất cả.</div>

  <div class="toolbar">
    <button class="btn btn-green" onclick="arrangeAll()">Xếp cửa sổ (thấy hết)</button>
    <button class="btn btn-ghost" onclick="refresh()">Làm mới</button>
    <a class="btn btn-ghost" href="/dashboard">Dashboard / Mở Chrome</a>
  </div>

  <div class="cards" id="cards"></div>
  <div class="hint">
    Cách dùng: 1) Mở Chrome từng học viên (profile user-{id}). 2) Vào trang khóa/bài học
    <b>namcaonguyen.huelms.com</b>. 3) Bấm thẻ học viên → cửa sổ đó lên trên → giờ được tính.
    Muốn xếp tất cả thấy được → nút "Xếp cửa sổ". Dừng auto: <b>Ctrl+F8</b> (auto-py) hoặc <b>Ctrl+Shift+S</b> (extension).
  </div>

  <div class="toast" id="toast"></div>

<script>
const API = '';
let last = null;

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
  return res.json();
}

function showToast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2500);
}

function rectText(r) {
  if (!r) return '';
  return `${r.width}x${r.height} @ ${r.left},${r.top}`;
}

async function focusUser(id, ev) {
  if (ev) ev.stopPropagation();
  try {
    const r = await fetchJson(`${API}/focus-window?user_id=${id}`);
    showToast(r.ok ? `Đã đưa user ${id} lên trên` : r.error);
  } catch (e) { showToast('Lỗi focus: ' + e.message, true); }
}

async function minimizeUser(id, ev) {
  if (ev) ev.stopPropagation();
  try {
    await fetchJson(`${API}/minimize-window?user_id=${id}`);
  } catch (e) { showToast('Lỗi minimize: ' + e.message, true); }
}

function courseSummary(courses) {
  if (!courses || !courses.length) return '<span class="pending">Chưa có dữ liệu khóa</span>';
  return courses.map(c => {
    const pct = Math.round(c.progress || 0);
    const cls = c.passed ? 'ok' : 'pending';
    const tag = c.passed ? '✓' : pct + '%';
    return `<div class="${cls}">${escapeHtml(c.course_name)}: ${tag}</div>`;
  }).join('');
}

function render(windows, insights) {
  const byId = {};
  (insights || []).forEach(i => { byId[i.user_id] = i; });
  const box = document.getElementById('cards');
  if (!windows.length) {
    box.innerHTML = '<div class="empty">Không thấy cửa sổ Chrome nào của học viên.<br>Mở Chrome từng học viên (profile user-{id}) rồi bấm Làm mới.</div>';
    return;
  }
  box.innerHTML = windows.map(w => {
    const ins = byId[w.user_id];
    const name = ins?.name || ('Học viên #' + w.user_id);
    const status = ins?.is_running ? 'Đang chạy' : (ins?.is_finish ? 'Hoàn thành' : 'Tạm dừng');
    const hours = ins ? (ins.today_hours || 0).toFixed(1) : '0.0';
    const courses = ins ? courseSummary(ins.courses) : '';
    return `
    <div class="card" onclick="focusUser(${w.user_id})">
      <h3>${escapeHtml(name)} <span style="color:var(--muted);font-size:12px">#${w.user_id}</span></h3>
      <div class="meta">${w.title ? escapeHtml(w.title) : '(không tiêu đề)'}<br>${rectText(w.rect)}</div>
      <div class="progress"><b>${status}</b> · Hôm nay: ${hours}h<br>${courses}</div>
      <div class="actions">
        <button class="focus" onclick="focusUser(${w.user_id}, event)">Lên trên</button>
        <button class="min" onclick="minimizeUser(${w.user_id}, event)">Thu nhỏ</button>
      </div>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function refresh() {
  try {
    const [winData, insData] = await Promise.all([
      fetchJson(`${API}/windows`),
      fetchJson(`${API}/accounts-insights`).catch(() => ({ insights: [] })),
    ]);
    render(winData.windows || [], insData.insights || []);
  } catch (e) {
    document.getElementById('cards').innerHTML = `<div class="empty">Lỗi: ${escapeHtml(e.message)}</div>`;
  }
}

async function arrangeAll() {
  try {
    const r = await fetchJson(`${API}/arrange-windows`);
    showToast(`Đã xếp ${r.arranged} cửa sổ`);
    setTimeout(refresh, 800);
  } catch (e) { showToast('Lỗi xếp cửa sổ: ' + e.message, true); }
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
"""


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard_page():
    return DASHBOARD_HTML


@app.get("/manager", response_class=HTMLResponse)
def manager_page():
    return MANAGER_HTML


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
