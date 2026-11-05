import base64
import binascii
import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES_DIR = ROOT / "Templates"
IMAGE_DATA_URL = re.compile(r"^data:image/[a-zA-Z0-9.+-]+;base64,(.*)$", re.DOTALL)


class PresetAssetError(ValueError):
    pass


@dataclass
class PresetEntry:
    manifest_path: str
    json_path: Path
    data: dict


def load_manifest_entries():
    manifest_path = ROOT / "presets" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PresetAssetError(f"Unable to read {manifest_path.relative_to(ROOT)}: {error}") from error

    paths = manifest.get("presets") if isinstance(manifest, dict) else None
    if not isinstance(paths, list) or not paths:
        raise PresetAssetError('presets/manifest.json must contain a non-empty "presets" array')

    entries = []
    seen_paths = set()
    for preset_path in paths:
        if not isinstance(preset_path, str) or not preset_path.lower().endswith(".json"):
            raise PresetAssetError(f"Invalid preset path in manifest: {preset_path!r}")
        if preset_path in seen_paths:
            raise PresetAssetError(f"Duplicate preset path in manifest: {preset_path}")
        seen_paths.add(preset_path)
        json_path = (ROOT / "presets" / preset_path).resolve()
        if not json_path.is_relative_to(ROOT.resolve()):
            raise PresetAssetError(f"Preset path escapes the repository: {preset_path}")
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise PresetAssetError(f"Unable to read presets/{preset_path}: {error}") from error
        if not isinstance(data, dict) or not isinstance(data.get("id"), str) or not data["id"].strip():
            raise PresetAssetError(f"presets/{preset_path} must contain a non-empty string id")
        entries.append(PresetEntry(preset_path, json_path, data))

    ids = [entry.data["id"] for entry in entries]
    duplicates = sorted({preset_id for preset_id in ids if ids.count(preset_id) > 1})
    if duplicates:
        raise PresetAssetError(f"Duplicate preset ids: {', '.join(duplicates)}")
    return entries


def embedded_data(value):
    if not isinstance(value, str):
        return None
    match = IMAGE_DATA_URL.fullmatch(value)
    if not match:
        return None
    try:
        return base64.b64decode(match.group(1), validate=True)
    except (binascii.Error, ValueError) as error:
        raise PresetAssetError(f"Invalid base64 image data URL: {error}") from error


def resolve_local_asset(preset_path, value):
    if not isinstance(value, str) or not value:
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    relative = Path(unquote(parsed.path).lstrip("/\\"))
    candidates = [ROOT / relative, preset_path.parent / relative]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_relative_to(ROOT.resolve()) and resolved.is_file():
            return resolved
    return None


def open_image(source):
    try:
        image = Image.open(source)
        image.load()
        return ImageOps.exif_transpose(image)
    except (OSError, UnidentifiedImageError) as error:
        raise PresetAssetError(f"Unable to decode image: {error}") from error


def open_preset_image(preset_path, value):
    data = embedded_data(value)
    if data is not None:
        return open_image(BytesIO(data)), len(data), "embedded data URL"
    local_path = resolve_local_asset(preset_path, value)
    if local_path is not None:
        try:
            return open_image(local_path), local_path.stat().st_size, str(local_path.relative_to(ROOT))
        except OSError as error:
            raise PresetAssetError(f"Unable to read {local_path.relative_to(ROOT)}: {error}") from error
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        raise PresetAssetError("remote image URL; download it to Templates/ before preparing assets")
    raise PresetAssetError(f"image file was not found for {value!r}")


def asset_slug(preset_id):
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", preset_id.strip()).strip("-_").lower()
    return slug or "preset"


def output_urls(entry):
    slug = asset_slug(entry.data["id"])
    return f"./Templates/{slug}.webp", f"./Templates/{slug}-thumb.webp"


def format_dimensions(image):
    return f"{image.width}x{image.height}"


def write_frame_webp(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
    image.convert(mode).save(path, format="WEBP", lossless=True, method=6)


def write_thumbnail(image, path, max_edge=360):
    image = image.copy()
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
    image.convert(mode).save(path, format="WEBP", quality=80, method=6)


def repository_path(url):
    return url.removeprefix("./")
