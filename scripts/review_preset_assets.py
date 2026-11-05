from preset_assets import (
    PresetAssetError,
    embedded_data,
    format_dimensions,
    load_manifest_entries,
    open_preset_image,
    output_urls,
    repository_path,
    resolve_local_asset,
)


def inspect_image(entry, key, required):
    value = entry.data.get(key)
    label = f"presets/{entry.manifest_path}: {key}"
    if not isinstance(value, str) or not value:
        state = "ERROR: missing" if required else "MISSING (thumbnail can be generated)"
        print(f"  {label}: {state}")
        return 1 if required else 0

    try:
        data = embedded_data(value)
        if data is not None:
            image, size, _ = open_preset_image(entry.json_path, value)
            print(f"  {label}: embedded {format_dimensions(image)}, {size:,} bytes")
            return 0
        if value.startswith(("http://", "https://")):
            print(f"  {label}: external URL (not processed locally): {value}")
            return 1 if required else 0
        local_path = resolve_local_asset(entry.json_path, value)
        if local_path is None:
            if required:
                print(f"  {label}: ERROR: file not found: {value}")
                return 1
            print(f"  {label}: missing file (thumbnail will be generated): {value}")
            return 0
        image, size, source = open_preset_image(entry.json_path, value)
        print(f"  {label}: {source}, {format_dimensions(image)}, {size:,} bytes")
        return 0
    except PresetAssetError as error:
        print(f"  {label}: ERROR: {error}")
        return 1


def main():
    try:
        entries = load_manifest_entries()
    except PresetAssetError as error:
        print(f"ERROR: {error}")
        return 1

    print(f"Preset asset review: {len(entries)} manifest preset(s)")
    errors = 0
    for entry in entries:
        print(f"\n{entry.data.get('title', entry.data['id'])} [{entry.data['id']}]")
        frame_url, thumbnail_url = output_urls(entry)
        try:
            frame_embedded = embedded_data(entry.data.get("frameImageUrl")) is not None
        except PresetAssetError:
            frame_embedded = False
        errors += inspect_image(entry, "frameImageUrl", required=True)
        errors += inspect_image(entry, "thumbnailUrl", required=False)

        if frame_embedded:
            print(f"  Generator: extract/convert frame to {repository_path(frame_url)}")
        elif isinstance(entry.data.get("frameImageUrl"), str):
            source_path = resolve_local_asset(entry.json_path, entry.data["frameImageUrl"])
            if source_path and source_path.suffix.lower() != ".webp":
                print(f"  Generator: convert frame to {repository_path(frame_url)}")

        thumbnail_path = resolve_local_asset(entry.json_path, entry.data.get("thumbnailUrl"))
        if not thumbnail_path:
            print(f"  Generator: create thumbnail at {repository_path(thumbnail_url)}")

    if errors:
        print(f"\nReview found {errors} error(s). Fix these before generating assets.")
        return 1
    print("\nReview completed with no blocking errors. No files were changed.")
    print("Run python scripts/prepare_preset_assets.py --apply after reviewing the report.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
