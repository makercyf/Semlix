#!/usr/bin/env python3
"""
Generate Semlix application icons for the Electron + TypeScript desktop app.
Creates cross-platform PNG icon sizes, a multi-resolution Windows ICO, a copy
of the source SVG for Linux/macOS packaging, and an optional ZIP.

Requirements:
    python -m pip install cairosvg pillow

Usage:
    python generate_icons.py semlix-icon.svg
    python generate_icons.py semlix-icon.svg --output dist/icons
    python generate_icons.py semlix-icon.svg --sizes 16 20 24 28 32 36 40 48 56 64 72 80 96 128 256 512
    python generate_icons.py semlix-icon.svg --output dist/icons --ico-only
    python generate_icons.py semlix-icon.svg --no-zip
"""

from __future__ import annotations

import argparse
import shutil
import struct
import sys
import zipfile
from pathlib import Path

try:
    import cairosvg
except ImportError:
    cairosvg = None

try:
    from PIL import Image
except ImportError:
    print(
        "Missing dependency: Pillow\n"
        "Install it with: python -m pip install cairosvg pillow",
        file=sys.stderr,
    )
    raise SystemExit(1)


PROJECT_NAME = "Semlix"
DEFAULT_ICON_NAME = "semlix"
# Windows uses 16 logical pixels for small icons and 32 logical pixels for
# large/taskbar icons. Include exact bitmap frames for every commonly offered
# scale factor so the shell does not need to resize a neighboring frame.
WINDOWS_DPI_SCALES = [100, 125, 150, 175, 200, 225, 250, 300]
WINDOWS_LOGICAL_ICON_SIZES = [16, 32]
WINDOWS_DPI_ICON_SIZES = sorted(
    {
        logical_size * scale // 100
        for logical_size in WINDOWS_LOGICAL_ICON_SIZES
        for scale in WINDOWS_DPI_SCALES
    }
)
DEFAULT_ICO_SIZES = sorted({*WINDOWS_DPI_ICON_SIZES, 128, 256})
DEFAULT_PNG_SIZES = sorted({*DEFAULT_ICO_SIZES, 512, 1024})
PRIMARY_ICO_SIZE = 32


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("Size values must be positive integers.")
    return number


def render_png(svg_bytes: bytes, output_path: Path, size: int) -> None:
    if cairosvg is None:
        raise RuntimeError(
            "Missing dependency: cairosvg\n"
            "Install it with: python -m pip install cairosvg pillow"
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(
        bytestring=svg_bytes,
        write_to=str(output_path),
        output_width=size,
        output_height=size,
    )


def create_ico(
    png_dir: Path,
    output_path: Path,
    ico_sizes: list[int],
) -> None:
    """Pack the independently rendered PNG sizes into a Windows ICO.

    Electron on Windows can consume a multi-resolution ICO for the app and
    BrowserWindow icon. Every frame is rendered independently from the SVG,
    allowing Windows to select an exact-size image instead of scaling one and
    making the taskbar icon blurry.
    """
    ordered_sizes = sorted(set(ico_sizes))
    if PRIMARY_ICO_SIZE in ordered_sizes:
        ordered_sizes.remove(PRIMARY_ICO_SIZE)
        ordered_sizes.insert(0, PRIMARY_ICO_SIZE)

    frames: list[tuple[int, bytes]] = []
    for size in ordered_sizes:
        source_path = png_dir / f"icon-{size}x{size}.png"
        if not source_path.exists():
            raise FileNotFoundError(f"ICO source render not found: {source_path}")
        with Image.open(source_path) as image:
            if image.size != (size, size) or image.mode != "RGBA":
                raise ValueError(
                    f"ICO source must be {size}x{size} RGBA: {source_path}"
                )
        frames.append((size, source_path.read_bytes()))

    directory_size = 6 + 16 * len(frames)
    offset = directory_size
    entries = []
    for size, frame in frames:
        dimension = 0 if size == 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(frame),
                offset,
            )
        )
        offset += len(frame)

    output_path.write_bytes(
        struct.pack("<HHH", 0, 1, len(frames))
        + b"".join(entries)
        + b"".join(frame for _, frame in frames)
    )


def create_zip(source_dir: Path, zip_path: Path) -> None:
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(source_dir.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(source_dir.parent))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=f"Generate {PROJECT_NAME} Electron icon assets from an SVG file."
    )
    parser.add_argument(
        "svg",
        type=Path,
        help="Path to the source SVG file.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("generated-icons"),
        help="Output directory. Default: generated-icons",
    )
    parser.add_argument(
        "--name",
        default=DEFAULT_ICON_NAME,
        help=f"Base filename. Default: {DEFAULT_ICON_NAME}",
    )
    parser.add_argument(
        "--sizes",
        nargs="+",
        type=positive_int,
        default=DEFAULT_PNG_SIZES,
        help="PNG sizes to generate.",
    )
    parser.add_argument(
        "--ico-sizes",
        nargs="+",
        type=positive_int,
        default=DEFAULT_ICO_SIZES,
        help="Sizes to embed in the Windows ICO.",
    )
    parser.add_argument(
        "--ico-only",
        action="store_true",
        help="Rebuild the ICO from existing per-size PNGs without rendering the SVG.",
    )
    parser.add_argument(
        "--no-ico",
        action="store_true",
        help="Do not create a Windows ICO file.",
    )
    parser.add_argument(
        "--no-zip",
        action="store_true",
        help="Do not create a ZIP archive.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete the output directory before generating files.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    svg_path = args.svg.expanduser().resolve()
    if not args.ico_only and not svg_path.is_file():
        print(f"SVG file not found: {svg_path}", file=sys.stderr)
        return 1

    output_dir = args.output.expanduser().resolve()
    if args.clean and output_dir.exists():
        shutil.rmtree(output_dir)

    png_dir = output_dir / "png"
    png_dir.mkdir(parents=True, exist_ok=True)

    name = args.name
    png_sizes = sorted(set(args.sizes))
    ico_sizes = sorted(set(args.ico_sizes))

    if not args.no_ico:
        unsupported = [size for size in ico_sizes if size > 256]
        if unsupported:
            print(
                "ICO sizes above 256 are not supported by this script: "
                + ", ".join(map(str, unsupported)),
                file=sys.stderr,
            )
            return 1

    print(f"Source: {svg_path}")
    print(f"Output: {output_dir}")

    if not args.ico_only:
        svg_bytes = svg_path.read_bytes()
        copied_svg = output_dir / f"{name}.svg"
        copied_svg.write_bytes(svg_bytes)

        render_sizes = set(png_sizes)
        if not args.no_ico:
            render_sizes.add(max(256, max(ico_sizes)))

        try:
            for size in sorted(render_sizes):
                png_path = png_dir / f"icon-{size}x{size}.png"
                render_png(svg_bytes, png_path, size)
                print(f"Created {png_path.relative_to(output_dir)}")
        except RuntimeError as error:
            print(error, file=sys.stderr)
            return 1

    ico_path = output_dir / f"{name}.ico"
    if not args.no_ico:
        create_ico(png_dir, ico_path, ico_sizes)
        print(f"Created {ico_path.relative_to(output_dir)}")

    readme = output_dir / "README.txt"
    readme.write_text(
        "\n".join(
            [
                f"Project: {PROJECT_NAME}",
                "Framework: Electron + TypeScript",
                f"Icon source: {svg_path.name}",
                "",
                "PNG sizes:",
                ", ".join(str(size) for size in png_sizes),
                "",
                "ICO sizes:",
                "Not generated" if args.no_ico else ", ".join(str(size) for size in ico_sizes),
                "",
                "Primary ICO frame:",
                "Not generated" if args.no_ico else f"{PRIMARY_ICO_SIZE} (first entry)",
                "",
                "Windows DPI coverage:",
                "Not generated"
                if args.no_ico
                else ", ".join(f"{scale}%" for scale in WINDOWS_DPI_SCALES),
                "",
                "Suggested Electron + TypeScript usage:",
                f"  Windows app / BrowserWindow: {name}.ico",
                "  Windows tray: use the ICO or an exact-size small PNG",
                f"  Linux packaging: {name}.svg (scalable) or the png directory",
                "  Linux BrowserWindow: png/icon-512x512.png",
                f"  macOS packaging: {name}.svg (electron-builder creates the bundle icon)",
                "  macOS BrowserWindow: omit icon and let the app bundle manage the Dock icon",
                "",
            ]
        ),
        encoding="utf-8",
    )

    if not args.no_zip:
        zip_path = output_dir.parent / f"{output_dir.name}.zip"
        create_zip(output_dir, zip_path)
        print(f"Created {zip_path}")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
