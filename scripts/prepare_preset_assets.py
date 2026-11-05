import argparse
import json
import sys

from preset_assets import (
    ROOT,
    TEMPLATES_DIR,
    PresetAssetError,
    embedded_data,
    load_manifest_entries,
    open_preset_image,
    output_urls,
    repository_path,
    resolve_local_asset,
    write_frame_webp,
    write_thumbnail,
)


def plan_entry(entry):
    frame_url = entry.data.get("frameImageUrl")
    if not isinstance(frame_url, str) or not frame_url:
        raise PresetAssetError("missing frameImageUrl")

    image, _, source = open_preset_image(entry.json_path, frame_url)
    generated_frame_url, generated_thumbnail_url = output_urls(entry)
    frame_is_embedded = embedded_data(frame_url) is not None
    frame_file = resolve_local_asset(entry.json_path, frame_url)
    should_convert_frame = frame_is_embedded or (frame_file and frame_file.suffix.lower() not in (".webp",))

    current_thumbnail = entry.data.get("thumbnailUrl")
    thumbnail_is_local = resolve_local_asset(entry.json_path, current_thumbnail) is not None
    thumbnail_is_data = embedded_data(current_thumbnail) is not None
    should_generate_thumbnail = not thumbnail_is_local or thumbnail_is_data

    target_frame_url = generated_frame_url if should_convert_frame else frame_url
    target_thumbnail_url = generated_thumbnail_url if should_generate_thumbnail else current_thumbnail
    frame_path = TEMPLATES_DIR / generated_frame_url.rsplit("/", 1)[-1]
    thumbnail_path = TEMPLATES_DIR / generated_thumbnail_url.rsplit("/", 1)[-1]

    return {
        "image": image,
        "source": source,
        "frame_file": frame_file,
        "frame_url": target_frame_url,
        "thumbnail_url": target_thumbnail_url,
        "current_frame_url": frame_url,
        "current_thumbnail_url": current_thumbnail,
        "write_frame": should_convert_frame,
        "write_thumbnail": should_generate_thumbnail,
        "frame_path": frame_path,
        "thumbnail_path": thumbnail_path,
    }


def ensure_unique_outputs(plans):
    seen = {}
    for entry, plan in plans:
        outputs = []
        if plan["write_frame"]:
            outputs.append(plan["frame_path"])
        if plan["write_thumbnail"]:
            outputs.append(plan["thumbnail_path"])
        for output in outputs:
            previous = seen.get(output)
            if previous:
                raise PresetAssetError(
                    f"Presets {previous} and {entry.data['id']} would both write "
                    f"{output.relative_to(ROOT)}; rename one preset id"
                )
            seen[output] = entry.data["id"]


def main():
    parser = argparse.ArgumentParser(
        description="Preview preset asset changes, or create optimized WebP frames/thumbnails with --apply."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="write generated assets and update preset JSON (default is preview only)",
    )
    args = parser.parse_args()

    try:
        entries = load_manifest_entries()
        plans = [(entry, plan_entry(entry)) for entry in entries]
        ensure_unique_outputs(plans)
    except PresetAssetError as error:
        print(f"ERROR: {error}")
        return 1

    print("Preset asset preparation plan" + (" (APPLY)" if args.apply else " (preview only)"))
    for entry, plan in plans:
        print(f"\n{entry.data.get('title', entry.data['id'])} [{entry.data['id']}]")
        print(f"  Frame source: {plan['source']}")
        if plan["write_frame"]:
            print(f"  Frame output: {repository_path(plan['frame_url'])}")
        else:
            print("  Frame output: unchanged")
        if plan["write_thumbnail"]:
            print(f"  Thumbnail output: {repository_path(plan['thumbnail_url'])}")
        else:
            print("  Thumbnail output: unchanged")
        if plan["frame_url"] != plan["current_frame_url"]:
            print(f"  JSON frameImageUrl: {plan['current_frame_url'][:80]}... -> {plan['frame_url']}")
        if plan["thumbnail_url"] != plan["current_thumbnail_url"]:
            current_thumbnail = plan["current_thumbnail_url"]
            if isinstance(current_thumbnail, str) and current_thumbnail.startswith("data:"):
                current_thumbnail = f"embedded data URL ({len(current_thumbnail):,} characters)"
            print(f"  JSON thumbnailUrl: {current_thumbnail!r} -> {plan['thumbnail_url']}")
        if plan["write_frame"] and plan["frame_path"].exists():
            print(f"ERROR: refusing to overwrite {plan['frame_path'].relative_to(ROOT)}")
            return 1
        if plan["write_thumbnail"] and plan["thumbnail_path"].exists():
            print(f"ERROR: refusing to overwrite {plan['thumbnail_path'].relative_to(ROOT)}")
            return 1

    if not args.apply:
        print("\nNo files were changed. Review this plan, then add --apply to generate assets.")
        return 0

    changed_entries = []
    for entry, plan in plans:
        if plan["write_frame"]:
            write_frame_webp(plan["image"], plan["frame_path"])
        if plan["write_thumbnail"]:
            write_thumbnail(plan["image"], plan["thumbnail_path"])
        if (
            plan["frame_url"] != plan["current_frame_url"]
            or plan["thumbnail_url"] != plan["current_thumbnail_url"]
        ):
            entry.data["frameImageUrl"] = plan["frame_url"]
            entry.data["thumbnailUrl"] = plan["thumbnail_url"]
            changed_entries.append(entry)

    for entry in changed_entries:
        entry.json_path.write_text(
            json.dumps(entry.data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    if changed_entries:
        print(f"\nAssets created and updated {len(changed_entries)} preset JSON file(s).")
    else:
        print("\nNo assets or preset JSON files needed updating.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, PresetAssetError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
