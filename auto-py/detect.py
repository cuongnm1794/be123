"""Tim vi tri template trong anh bang OpenCV."""
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MatchMethod = int


@dataclass
class Match:
    x: int
    y: int
    width: int
    height: int
    confidence: float

    @property
    def center(self) -> tuple[int, int]:
        return (self.x + self.width // 2, self.y + self.height // 2)


def _load_bgr(path: Path) -> np.ndarray:
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(f"Khong doc duoc anh: {path}")
    return image


def detect_template(
    image_path: str | Path,
    template_path: str | Path,
    threshold: float = 0.8,
    method: MatchMethod = cv2.TM_CCOEFF_NORMED,
) -> list[Match]:
    """
    Tim tat ca vi tri khop template trong anh lon.

    Tra ve danh sach Match (x, y la goc tren-trai), sap xep theo confidence giam dan.
    """
    image = _load_bgr(Path(image_path))
    template = _load_bgr(Path(template_path))
    th, tw = template.shape[:2]

    if th > image.shape[0] or tw > image.shape[1]:
        raise ValueError("Template lon hon anh can tim.")

    result = cv2.matchTemplate(image, template, method)
    locations = np.where(result >= threshold)
    matches = [
        Match(
            x=int(x),
            y=int(y),
            width=tw,
            height=th,
            confidence=float(result[y, x]),
        )
        for x, y in zip(*locations[::-1])
    ]
    matches.sort(key=lambda m: m.confidence, reverse=True)
    return _suppress_overlaps(matches)


def _suppress_overlaps(matches: list[Match]) -> list[Match]:
    """Giu match manh nhat khi nhieu diem trung vung."""
    kept: list[Match] = []
    for m in matches:
        if any(
            abs(m.x - k.x) < m.width and abs(m.y - k.y) < m.height for k in kept
        ):
            continue
        kept.append(m)
    return kept


if __name__ == "__main__":
    screen = Path("images/chrome_20260603_133539.png")
    icon = Path("images/assets/1.png")
    found = detect_template(screen, icon)
    if not found:
        print("Khong tim thay.")
    else:
        for i, m in enumerate(found, 1):
            print(
                f"#{i}: ({m.x}, {m.y}) size {m.width}x{m.height} "
                f"conf={m.confidence:.3f} center={m.center}"
            )
