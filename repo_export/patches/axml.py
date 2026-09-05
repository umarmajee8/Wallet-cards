#!/usr/bin/env python3
"""Minimal binary AndroidManifest.xml (AXML) reader / in-place boolean patcher.

Only what we need for release hardening: read the string pool, walk START_TAG
chunks, and flip a typed boolean attribute (e.g. android:allowBackup) without
changing any chunk size, so the manifest stays byte-compatible.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

RES_STRING_POOL_TYPE = 0x0001
RES_XML_TYPE = 0x0003
RES_XML_START_ELEMENT_TYPE = 0x0102
RES_XML_RESOURCE_MAP_TYPE = 0x0180

TYPE_INT_BOOLEAN = 0x12
TYPE_INT_DEC = 0x10
TYPE_STRING = 0x03
TYPE_REFERENCE = 0x01

UTF8_FLAG = 1 << 8


def _decode_length_utf8(buf: bytes, off: int) -> tuple[int, int]:
    n = buf[off]
    off += 1
    if n & 0x80:
        n = ((n & 0x7F) << 8) | buf[off]
        off += 1
    return n, off


def _decode_length_utf16(buf: bytes, off: int) -> tuple[int, int]:
    n = struct.unpack_from("<H", buf, off)[0]
    off += 2
    if n & 0x8000:
        n2 = struct.unpack_from("<H", buf, off)[0]
        off += 2
        n = ((n & 0x7FFF) << 16) | n2
    return n, off


def parse_string_pool(data: bytes, off: int) -> list[str]:
    typ, header_size, chunk_size = struct.unpack_from("<HHI", data, off)
    assert typ == RES_STRING_POOL_TYPE, f"not a string pool: 0x{typ:04x}"
    string_count, style_count, flags, strings_start, styles_start = struct.unpack_from(
        "<IIIII", data, off + 8
    )
    utf8 = bool(flags & UTF8_FLAG)
    offsets = struct.unpack_from(f"<{string_count}I", data, off + header_size)
    base = off + strings_start
    out = []
    for so in offsets:
        p = base + so
        if utf8:
            _chars, p = _decode_length_utf8(data, p)
            nbytes, p = _decode_length_utf8(data, p)
            out.append(data[p : p + nbytes].decode("utf-8", "replace"))
        else:
            nchars, p = _decode_length_utf16(data, p)
            out.append(data[p : p + nchars * 2].decode("utf-16-le", "replace"))
    return out


@dataclass
class Attribute:
    tag: str
    name: str
    ns: str
    data_type: int
    data: int
    raw_value: int
    value_offset: int  # absolute offset of the 4-byte Res_value.data field
    type_offset: int  # absolute offset of the 1-byte Res_value.dataType field
    string: str | None = None  # resolved value for TYPE_STRING attributes


def iter_attributes(data: bytes):
    """Yield Attribute for every attribute of every START_TAG in the AXML."""
    typ, header_size, total = struct.unpack_from("<HHI", data, 0)
    assert typ == RES_XML_TYPE, f"not AXML: 0x{typ:04x}"
    strings: list[str] = []
    off = header_size
    while off < min(total, len(data)):
        ctyp, chdr, csize = struct.unpack_from("<HHI", data, off)
        if csize <= 0:
            break
        if ctyp == RES_STRING_POOL_TYPE and not strings:
            strings = parse_string_pool(data, off)
        elif ctyp == RES_XML_START_ELEMENT_TYPE:
            ns_idx, name_idx = struct.unpack_from("<ii", data, off + 16)
            attr_start, attr_size, attr_count = struct.unpack_from("<HHH", data, off + 24)
            tag = strings[name_idx] if 0 <= name_idx < len(strings) else f"?{name_idx}"
            abase = off + 16 + attr_start
            for i in range(attr_count):
                a = abase + i * attr_size
                a_ns, a_name, a_raw = struct.unpack_from("<iii", data, a)
                _vsize, _res0, vtype = struct.unpack_from("<HBB", data, a + 12)
                (vdata,) = struct.unpack_from("<I", data, a + 16)
                yield Attribute(
                    tag=tag,
                    name=strings[a_name] if 0 <= a_name < len(strings) else f"?{a_name}",
                    ns=strings[a_ns] if 0 <= a_ns < len(strings) else "",
                    data_type=vtype,
                    data=vdata,
                    raw_value=a_raw,
                    value_offset=a + 16,
                    type_offset=a + 15,
                    string=(
                        strings[vdata]
                        if vtype == TYPE_STRING and 0 <= vdata < len(strings)
                        else None
                    ),
                )
        off += csize


def get_attribute(data: bytes, tag: str, name: str) -> Attribute | None:
    for attr in iter_attributes(data):
        if attr.tag == tag and attr.name == name:
            return attr
    return None


def set_boolean(data: bytes, tag: str, name: str, value: bool) -> bytes:
    """Flip a TYPE_INT_BOOLEAN attribute in place. Size-preserving."""
    attr = get_attribute(data, tag, name)
    if attr is None:
        raise KeyError(f"<{tag} {name}> not found in manifest")
    if attr.data_type != TYPE_INT_BOOLEAN:
        raise TypeError(f"{name} is not a boolean (type 0x{attr.data_type:02x})")
    out = bytearray(data)
    struct.pack_into("<I", out, attr.value_offset, 0xFFFFFFFF if value else 0x00000000)
    return bytes(out)


def describe(data: bytes) -> str:
    lines = []
    for attr in iter_attributes(data):
        if attr.data_type == TYPE_INT_BOOLEAN:
            val = "true" if attr.data == 0xFFFFFFFF else "false"
        elif attr.data_type == TYPE_INT_DEC:
            val = str(attr.data)
        elif attr.data_type == TYPE_REFERENCE:
            val = f"@0x{attr.data:08x}"
        elif attr.data_type == TYPE_STRING:
            val = attr.string or ""
        else:
            val = f"0x{attr.data:08x}(type 0x{attr.data_type:02x})"
        lines.append(f"{attr.tag}: {attr.name} = {val}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    import zipfile

    apk = sys.argv[1]
    with zipfile.ZipFile(apk) as z:
        blob = z.read("AndroidManifest.xml")
    print(describe(blob))
