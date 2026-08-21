from fastapi import FastAPI, Query
import uvicorn
import threading

from mouse import click_at, move_to

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

    keyboard.add_hotkey("ctrl+shift+q", set_stop)
    keyboard.add_hotkey("ctrl+shift+r", reset_stop)
    print("Hotkeys: Ctrl+Shift+Q = STOP, Ctrl+Shift+R = RESET")
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
        "hotkeys": "Ctrl+Shift+Q = STOP, Ctrl+Shift+R = RESET",
    }


@app.get("/move")
def move(
    x: int = Query(..., description="Toa do X (tu extension)"),
    y: int = Query(..., description="Toa do Y (tu extension)"),
):
    move_to(x, y)
    return {"ok": True, "x": x, "y": y}


@app.get("/click")
def click(
    x: int = Query(..., description="Toa do X (tu extension)"),
    y: int = Query(..., description="Toa do Y (tu extension)"),
):
    click_at(x, y)
    return {"ok": True, "x": x, "y": y}


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


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
