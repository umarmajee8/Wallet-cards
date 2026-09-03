#!/usr/bin/env python3
"""Replace the web bundle inside the APK and v1+v2-sign it."""
from __future__ import annotations

import hashlib
import io
import os
import struct
import zipfile
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]
SRC_APK = ROOT / "CardWallet_no_pouch.apk"
JS_SRC = ROOT / "app" / "index.js"
JS_NAME = "assets/public/assets/index-DfWhHAzK.js"
OUT_APK = ROOT.parent / "CardWallet_no_autodetect.apk"
KEY_DIR = ROOT / "signing"
KEY_PEM = KEY_DIR / "debug-key.pem"
CERT_PEM = KEY_DIR / "debug-cert.pem"

SIG_ALGO_RSA_PKCS1_SHA256 = 0x0103
V2_BLOCK_ID = 0x7109871A
CHUNK = 1024 * 1024
SKIP_META = {".SF", ".RSA", ".DSA", ".EC"}


def load_or_make_key():
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    if KEY_PEM.exists() and CERT_PEM.exists():
        key = serialization.load_pem_private_key(KEY_PEM.read_bytes(), password=None)
        cert = x509.load_pem_x509_certificate(CERT_PEM.read_bytes())
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "CardWallet"),
            x509.NameAttribute(NameOID.COMMON_NAME, "CardWallet Debug"),
        ]
    )
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    KEY_PEM.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    CERT_PEM.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return key, cert


def wrap72(line: str) -> str:
    if len(line) <= 72:
        return line + "\r\n"
    out = [line[:72] + "\r\n"]
    rest = line[72:]
    while rest:
        out.append(" " + rest[:71] + "\r\n")
        rest = rest[71:]
    return "".join(out)


def jar_digest(data: bytes) -> str:
    import base64

    return base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")


def build_manifest(files: list[tuple[str, bytes]]) -> tuple[bytes, bytes]:
    header = "Manifest-Version: 1.0\r\nCreated-By: 1.0 (CardWallet)\r\n\r\n"
    sections = []
    sf_sections = []
    for name, data in files:
        section = wrap72(f"Name: {name}") + wrap72(f"SHA-256-Digest: {jar_digest(data)}") + "\r\n"
        sections.append(section)
        sf_sections.append(
            wrap72(f"Name: {name}")
            + wrap72(f"SHA-256-Digest: {jar_digest(section.encode('utf-8'))}")
            + "\r\n"
        )
    mf = (header + "".join(sections)).encode("utf-8")
    sf_header = (
        wrap72("Signature-Version: 1.0")
        + wrap72("Created-By: 1.0 (CardWallet)")
        + wrap72(f"SHA-256-Digest-Manifest: {jar_digest(mf)}")
        + "\r\n"
    )
    sf = (sf_header + "".join(sf_sections)).encode("utf-8")
    return mf, sf


def pkcs7_sign(sf: bytes, key, cert) -> bytes:
    return (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(sf)
        .add_signer(cert, key, hashes.SHA256())
        .sign(
            serialization.Encoding.DER,
            [
                pkcs7.PKCS7Options.DetachedSignature,
                pkcs7.PKCS7Options.Binary,
                pkcs7.PKCS7Options.NoCapabilities,
            ],
        )
    )


def deflate(data: bytes) -> bytes:
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()


class AlignedZip:
    def __init__(self):
        self.buf = bytearray()
        self.central = []

    def add(self, name: str, data: bytes, *, stored: bool, date_time, align=4, flag_bits=0):
        name_b = name.encode("utf-8")
        if stored:
            method = 0
            payload = data
        else:
            method = 8
            payload = deflate(data)
        crc = zlib.crc32(data) & 0xFFFFFFFF
        extra = b""
        if method == 0 and align:
            data_off = len(self.buf) + 30 + len(name_b)
            pad = (align - (data_off % align)) % align
            if pad and pad < 4:
                pad += align
            if pad:
                extra = struct.pack("<HH", 0x0000, pad - 4) + b"\x00" * (pad - 4)

        # DOS time
        dt = date_time
        dos_time = (dt[3] << 11) | (dt[4] << 5) | (dt[5] // 2)
        dos_date = ((dt[0] - 1980) << 9) | (dt[1] << 5) | dt[2]
        flags = flag_bits & ~0x08  # no data descriptor
        if any(b > 127 for b in name_b):
            flags |= 1 << 11

        local = struct.pack(
            "<IHHHHHIIIHH",
            0x04034B50,
            20,
            flags,
            method,
            dos_time,
            dos_date,
            crc,
            len(payload),
            len(data),
            len(name_b),
            len(extra),
        )
        offset = len(self.buf)
        self.buf += local + name_b + extra + payload
        cd = struct.pack(
            "<IHHHHHHIIIHHHHHII",
            0x02014B50,
            0x0317,  # made by unix / zip 2.3
            20,
            flags,
            method,
            dos_time,
            dos_date,
            crc,
            len(payload),
            len(data),
            len(name_b),
            0,  # extra
            0,  # comment
            0,  # disk
            0,  # int attr
            0,  # ext attr
            offset,
        )
        self.central.append(cd + name_b)

    def finish(self) -> bytes:
        cd_off = len(self.buf)
        cd = b"".join(self.central)
        self.buf += cd
        eocd = struct.pack(
            "<IHHHHIIH",
            0x06054B50,
            0,
            0,
            len(self.central),
            len(self.central),
            len(cd),
            cd_off,
            0,
        )
        self.buf += eocd
        return bytes(self.buf)


def chunk_digest(parts: list[bytes]) -> bytes:
    """SHA-256 of 1MiB chunks over concatenated parts, APK v2 style."""
    hasher = hashlib.sha256()
    chunk_count = 0
    buf = b""

    def feed(block: bytes):
        nonlocal buf, chunk_count
        buf += block
        while len(buf) >= CHUNK:
            piece = buf[:CHUNK]
            buf = buf[CHUNK:]
            h = hashlib.sha256()
            h.update(b"\xa5")
            h.update(struct.pack("<I", len(piece)))
            h.update(piece)
            hasher.update(h.digest())
            chunk_count += 1

    for p in parts:
        feed(p)
    if buf:
        h = hashlib.sha256()
        h.update(b"\xa5")
        h.update(struct.pack("<I", len(buf)))
        h.update(buf)
        hasher.update(h.digest())
        chunk_count += 1
    top = hashlib.sha256()
    top.update(b"\x5a")
    top.update(struct.pack("<I", chunk_count))
    top.update(hasher.digest() if False else b"")  # placeholder, rebuild properly
    # The above hasher.digest() is wrong because we concatenated chunk digests
    # into hasher as if it were a running sha256 of concatenated digests... wait
    # We need concatenation of chunk SHA256s, then wrap.
    # Redo simply with a list.
    raise RuntimeError("use chunk_digest2")


def apk_chunk_digest(data: bytes) -> bytes:
    digests = []
    for i in range(0, len(data), CHUNK):
        piece = data[i : i + CHUNK]
        h = hashlib.sha256()
        h.update(b"\xa5")
        h.update(struct.pack("<I", len(piece)))
        h.update(piece)
        digests.append(h.digest())
    top = hashlib.sha256()
    top.update(b"\x5a")
    top.update(struct.pack("<I", len(digests)))
    top.update(b"".join(digests))
    return top.digest()


def u32pref(data: bytes) -> bytes:
    return struct.pack("<I", len(data)) + data


def find_eocd(apk: bytes) -> int:
    max_scan = min(len(apk) - 22, 65535)
    for i in range(len(apk) - 22, len(apk) - 22 - max_scan - 1, -1):
        if apk[i : i + 4] == b"PK\x05\x06":
            comment_len = struct.unpack_from("<H", apk, i + 20)[0]
            if i + 22 + comment_len == len(apk):
                return i
    raise ValueError("EOCD not found")


def sign_v2(apk: bytes, key, cert) -> bytes:
    eocd_off = find_eocd(apk)
    cd_off = struct.unpack_from("<I", apk, eocd_off + 16)[0]
    cd_size = struct.unpack_from("<I", apk, eocd_off + 12)[0]
    contents = apk[:cd_off]
    cd = apk[cd_off : cd_off + cd_size]
    eocd = bytearray(apk[eocd_off:])
    # EOCD used for digest must have CD offset = len(contents)
    eocd_digest = bytearray(eocd)
    struct.pack_into("<I", eocd_digest, 16, len(contents))

    # We need digest of contents + cd + eocd_digest, but the signing block
    # is not included. Compute after we know we digest those three parts as one.
    to_digest = bytes(contents) + bytes(cd) + bytes(eocd_digest)
    digest = apk_chunk_digest(to_digest)

    cert_der = cert.public_bytes(serialization.Encoding.DER)
    pub_der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )

    digest_pair = u32pref(struct.pack("<I", SIG_ALGO_RSA_PKCS1_SHA256) + u32pref(digest))
    signed_data = u32pref(digest_pair) + u32pref(u32pref(cert_der)) + u32pref(b"")

    signature = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    sig_pair = u32pref(struct.pack("<I", SIG_ALGO_RSA_PKCS1_SHA256) + u32pref(signature))
    signer = u32pref(signed_data) + u32pref(sig_pair) + u32pref(pub_der)
    v2_value = u32pref(u32pref(signer))

    pair = struct.pack("<I", V2_BLOCK_ID) + v2_value
    pair_with_len = struct.pack("<Q", len(pair)) + pair
    magic = b"APK Sig Block 42"
    size_of_block = len(pair_with_len) + 8 + 16
    block = struct.pack("<Q", size_of_block) + pair_with_len + struct.pack("<Q", size_of_block) + magic

    new_cd_off = len(contents) + len(block)
    eocd_out = bytearray(eocd)
    struct.pack_into("<I", eocd_out, 16, new_cd_off)
    return bytes(contents) + block + bytes(cd) + bytes(eocd_out)


def should_skip(name: str) -> bool:
    if not name.startswith("META-INF/"):
        return False
    upper = name.upper()
    if upper.endswith(".SF") or upper.endswith(".RSA") or upper.endswith(".DSA") or upper.endswith(".EC"):
        return True
    if name.split("/")[-1].upper() == "MANIFEST.MF":
        return True
    return False


def main():
    js = JS_SRC.read_bytes()
    if b"Auto-detect details" in js:
        raise SystemExit("JS still contains Auto-detect details")

    key, cert = load_or_make_key()
    src = zipfile.ZipFile(SRC_APK)
    entries: list[tuple[zipfile.ZipInfo, bytes]] = []
    for info in src.infolist():
        if should_skip(info.filename):
            continue
        if info.is_dir():
            continue
        data = js if info.filename == JS_NAME else src.read(info.filename)
        entries.append((info, data))
    src.close()

    # v1 over unsigned payload files (without signature files)
    files_for_mf = [(i.filename, d) for i, d in entries]
    mf, sf = build_manifest(files_for_mf)
    rsa_block = pkcs7_sign(sf, key, cert)

    z = AlignedZip()
    for info, data in entries:
        stored = info.compress_type == zipfile.ZIP_STORED
        z.add(
            info.filename,
            data,
            stored=stored,
            date_time=info.date_time,
            align=4 if stored else 0,
            flag_bits=info.flag_bits,
        )
    # signature files last, deflated
    now = datetime.now().timetuple()[:6]
    z.add("META-INF/MANIFEST.MF", mf, stored=False, date_time=now, align=0)
    z.add("META-INF/CERT.SF", sf, stored=False, date_time=now, align=0)
    z.add("META-INF/CERT.RSA", rsa_block, stored=False, date_time=now, align=0)

    unsigned = z.finish()
    signed = sign_v2(unsigned, key, cert)
    OUT_APK.write_bytes(signed)
    print(f"wrote {OUT_APK} ({len(signed)} bytes)")

    # sanity
    with zipfile.ZipFile(io.BytesIO(signed)) as chk:
        body = chk.read(JS_NAME)
        assert b"Auto-detect details" not in body
        assert b"Fill in from picture" not in body
        print("js entries ok, files", len(chk.namelist()))
    assert b"APK Sig Block 42" in signed
    print("v2 block present")


if __name__ == "__main__":
    main()
