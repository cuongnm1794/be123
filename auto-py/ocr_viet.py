"""OCR tieng Viet bang VietOCR, vung crop tu dong theo template anchor."""
from pathlib import Path

from PIL import Image
from vietocr.tool.config import Cfg
from vietocr.tool.predictor import Predictor

from detect import Match, detect_template

_predictor: Predictor | None = None

DEFAULT_TEMPLATE = Path("images/assets/1.png")

# Offset tu goc tren-trai template: (dx_left, dy_top, dx_right, dy_bottom)
# Calibrate 1 lan tu layout trang; sau do di theo vi tri template tren moi anh.
REGION_OFFSETS: dict[str, tuple[int, int, int, int]] = {
    "cau_hoi": (51, 560, 681, 600),
    "dap_an_1": (51, 600, 681, 640),
    "dap_an_2": (51, 640, 681, 680),
}


def get_predictor(device: str = "cpu") -> Predictor:
    global _predictor
    if _predictor is None:
        config = Cfg.load_config_from_name("vgg_transformer")
        config["device"] = device
        _predictor = Predictor(config)
    return _predictor


def regions_from_template(
    image_path: str | Path,
    template_path: str | Path = DEFAULT_TEMPLATE,
    threshold: float = 0.8,
) -> tuple[dict[str, tuple[int, int, int, int]], Match]:
    """Tim template lam moc, tinh box OCR tu offset tuong doi."""
    matches = detect_template(image_path, template_path, threshold=threshold)
    if not matches:
        raise RuntimeError(
            f"Khong tim thay template {template_path} trong {image_path}"
        )
    anchor = matches[0]
    ax, ay = anchor.x, anchor.y
    regions = {
        name: (ax + dl, ay + dt, ax + dr, ay + db)
        for name, (dl, dt, dr, db) in REGION_OFFSETS.items()
    }
    return regions, anchor


def ocr_image(
    image_path: str | Path,
    scale: int = 3,
    device: str = "cpu",
) -> str:
    """OCR mot anh (nen la 1 dong chu, khong phai full man hinh)."""
    img = Image.open(image_path).convert("RGB")
    if scale > 1:
        img = img.resize(
            (img.width * scale, img.height * scale),
            Image.Resampling.LANCZOS,
        )
    return get_predictor(device).predict(img)


def ocr_regions(
    image_path: str | Path,
    template_path: str | Path = DEFAULT_TEMPLATE,
    regions: dict[str, tuple[int, int, int, int]] | None = None,
    threshold: float = 0.8,
    scale: int = 3,
    device: str = "cpu",
) -> dict[str, str]:
    """Tim template -> tinh vung -> OCR tung dong."""
    img = Image.open(image_path).convert("RGB")
    predictor = get_predictor(device)

    if regions is None:
        regions, _ = regions_from_template(
            image_path, template_path, threshold=threshold
        )

    out: dict[str, str] = {}
    for name, box in regions.items():
        crop = img.crop(box)
        if scale > 1:
            crop = crop.resize(
                (crop.width * scale, crop.height * scale),
                Image.Resampling.LANCZOS,
            )
        out[name] = predictor.predict(crop)
    return out


if __name__ == "__main__":
    screen = Path("images/chrome_20260603_134508.png")
    template = DEFAULT_TEMPLATE

    regions, anchor = regions_from_template(screen, template)
    print(f"Anchor: ({anchor.x}, {anchor.y}) conf={anchor.confidence:.3f}")
    print("Vung crop:")
    for name, box in regions.items():
        print(f"  {name}: {box}")
    print()
    for name, text in ocr_regions(screen, template_path=template).items():
        print(f"{name}: {text}")
