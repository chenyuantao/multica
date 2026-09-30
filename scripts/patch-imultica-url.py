#!/usr/bin/env python3
"""Repoint the hard-coded endpoints of an imultica (darwin/arm64) binary.

Usage: scripts/patch-imultica-url.py <binary> <new-base-url>

New strings are written into the zero padding between the Mach-O load
commands and __text. Every reference found (ADRP+ADD+MOVZ length triples in
code, {ptr,len} string headers in data) is rewritten; the binary is then
ad-hoc re-signed. A .orig backup is kept next to the binary.
"""
import shutil
import struct
import subprocess
import sys

BASE = 0x100000000
OLD_API = b"https://api.multica.woa.com"
OLD_APP = b"https://multica.woa.com"
OLD_WSNEW = OLD_APP + b"/workspaces/new"


def u32(d, o):
    return struct.unpack_from("<I", d, o)[0]


def main():
    path, new = sys.argv[1], sys.argv[2].rstrip("/").encode()
    d = bytearray(open(path, "rb").read())
    assert u32(d, 0) == 0xFEEDFACF and u32(d, 4) == 0x0100000C, "not a Mach-O arm64 binary"
    hdr_end = 32 + u32(d, 20)

    text_off = text_size = None
    o = 32
    for _ in range(u32(d, 16)):
        cmd, size = struct.unpack_from("<II", d, o)
        if cmd == 0x19:  # LC_SEGMENT_64
            nsects = u32(d, o + 64)
            for s in range(nsects):
                so = o + 72 + s * 80
                if d[so:so + 16].rstrip(b"\0") == b"__text":
                    text_size = struct.unpack_from("<Q", d, so + 40)[0]
                    text_off = u32(d, so + 48)
        o += size
    assert text_off, "__text not found"

    # (old string, new string) — pick the occurrence that is actually referenced.
    specs = [(OLD_API, new), (OLD_APP, new), (OLD_WSNEW, new + b"/workspaces/new")]
    pad = (hdr_end + 0x7F) & ~0x3F
    assert all(b == 0 for b in d[pad:text_off]), "padding not empty (already patched?)"
    cursor = pad

    words = struct.unpack_from("<%dI" % (text_size // 4), d, text_off)
    total_code = total_data = 0
    for old, repl in specs:
        new_off = cursor
        d[new_off:new_off + len(repl)] = repl
        cursor = (cursor + len(repl) + 0x10) & ~0xF
        assert cursor < text_off, "not enough padding"
        new_va = BASE + new_off

        start = 0
        while (idx := d.find(old, start)) != -1:
            start = idx + 1
            va = BASE + idx
            # data string headers
            hdr = struct.pack("<QQ", va, len(old))
            h = d.find(hdr)
            while h != -1:
                d[h:h + 16] = struct.pack("<QQ", new_va, len(repl))
                total_data += 1
                h = d.find(hdr, h + 16)
            # code: ADRP xN; ADD xN, xN, #lo; ... MOVZ xM, #len
            for i, w in enumerate(words):
                if (w & 0x9F000000) != 0x90000000:
                    continue
                rd = w & 0x1F
                imm = (((w >> 5) & 0x7FFFF) << 2) | ((w >> 29) & 3)
                if imm & (1 << 20):
                    imm -= 1 << 21
                pc = BASE + text_off + i * 4
                page = (pc & ~0xFFF) + (imm << 12)
                for k in range(1, 4):
                    if i + k >= len(words):
                        break
                    w2 = words[i + k]
                    if (w2 & 0xFFC00000) == 0x91000000 and ((w2 >> 5) & 0x1F) == rd:
                        if page + ((w2 >> 10) & 0xFFF) != va:
                            break
                        mov_at = None
                        for m in range(i + k + 1, min(i + k + 5, len(words))):
                            w3 = words[m]
                            if (w3 & 0xFFE00000) == 0xD2800000 and ((w3 >> 5) & 0xFFFF) == len(old):
                                mov_at = m
                                break
                        if mov_at is None:
                            break  # same address, different string length
                        delta = ((new_va & ~0xFFF) - (pc & ~0xFFF)) >> 12
                        delta &= (1 << 21) - 1
                        adrp = 0x90000000 | ((delta & 3) << 29) | ((delta >> 2) << 5) | rd
                        add = (w2 & ~(0xFFF << 10)) | ((new_va & 0xFFF) << 10)
                        mov = (words[mov_at] & ~(0xFFFF << 5)) | (len(repl) << 5)
                        for j, val in ((i, adrp), (i + k, add), (mov_at, mov)):
                            struct.pack_into("<I", d, text_off + j * 4, val)
                        total_code += 1
                        print(f"  code {hex(pc)}: {old.decode()} -> {repl.decode()}")
                        break

    print(f"patched {total_code} code refs, {total_data} data headers")
    assert total_code and total_data, "nothing patched"
    shutil.copy2(path, path + ".orig")
    open(path, "wb").write(d)
    subprocess.run(["codesign", "-f", "-s", "-", path], check=True)


if __name__ == "__main__":
    main()
