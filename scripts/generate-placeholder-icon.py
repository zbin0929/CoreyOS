#!/usr/bin/env python3
"""
Generate a 1024x1024 placeholder source icon for Caduceus using only Python
stdlib (no Pillow). Produces an obsidian square with a gold disc in the center.
Run `pnpm tauri icon <this-file's output>` to fan out into all platform assets.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZE = 1024
BG = (15, 18, 24)       # hsl(225 18% 6%) approx
GOLD = (232, 181, 57)   # hsl(43 86% 58%) approx
CENTER = SIZE // 2
RADIUS = SIZE // 4


def build_image() -> bytes:
    # RGBA rows prefixed with filter byte 0.
    row_len = 1 + SIZE * 4
    buf = bytearray(row_len * SIZE)

    r2 = RADIUS * RADIUS
    for y in range(SIZE):
        dy = y - CENTER
        row_start = y * row_len
        buf[row_start] = 0  # filter: None
        for x in range(SIZE):
            dx = x - CENTER
            i = row_start + 1 + x * 4
            if dx * dx + dy * dy <= r2:
                buf[i : i + 4] = bytes((*GOLD, 255))
            else:
                buf[i : i + 4] = bytes((*BG, 255))
    return bytes(buf)


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path) -> None:
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(build_image(), 6)
    data = signature + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")
    path.write_bytes(data)
    print(f"wrote {len(data):,} bytes → {path}")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "source.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    write_png(out)
