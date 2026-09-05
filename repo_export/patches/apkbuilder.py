#!/usr/bin/env python3
"""APK repackaging + release signing (JAR v1 + APK Signature Scheme v2/v3).

Pure-Python: this sandbox/CI has no JDK and no Android SDK build-tools, so
zipalign/apksigner are re-implemented here. Output is byte-for-byte a normal
aligned, v1+v2+v3-signed APK.
"""
from __future__ import annotations

import base64
import hashlib
import os
import struct
import zipfile
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12, pkcs7
from cryptography.x509.oid import NameOID

SIG_ALGO_RSA_PKCS1_SHA256 = 0x0103
V2_BLOCK_ID = 0x7109871A
V3_BLOCK_ID = 0xF05368C0
VERITY_PADDING_BLOCK_ID = 0x42726577
STRIPPING_PROTECTION_ATTR_ID = 0xBEEFF00D
CHUNK = 1024 * 1024
MIN_SDK = 24  # v3 signer scope; manifest minSdk is 23 and stays v1/v2-covered
MAX_SDK = 0x7FFFFFFF

# .so / resources.arsc style entries stay STORED and 4-byte aligned;
# uncompressed native libs additionally want page alignment.
DEFAULT_ALIGN = 4
PAGE_ALIGN = 4096


# --------------------------------------------------------------------------
# Keystore
# --------------------------------------------------------------------------
class ReleaseKey:
    def __init__(self, key, cert, alias: str):
        self.key = key
        self.cert = cert
        self.alias = alias

    @property
    def cert_sha256(self) -> str:
        return self.cert.fingerprint(hashes.SHA256()).hex()

    @property
    def cert_sha1(self) -> str:
        return self.cert.fingerprint(hashes.SHA1()).hex()

    @property
    def key_size(self) -> int:
        return self.key.key_size

    def summary(self) -> str:
        return (
            f"alias={self.alias}\n"
            f"subject={self.cert.subject.rfc4514_string()}\n"
            f"key=RSA-{self.key_size}\n"
            f"valid_from={self.cert.not_valid_before_utc.isoformat()}\n"
            f"valid_to={self.cert.not_valid_after_utc.isoformat()}\n"
            f"sha256={self.cert_sha256}\n"
            f"sha1={self.cert_sha1}"
        )


def create_release_keystore(
    path: Path,
    password: bytes,
    alias: str = "cardwallet-release",
    common_name: str = "Card Wallet",
    org: str = "Card Wallet",
    org_unit: str = "Mobile",
    country: str = "PK",
    years: int = 30,
    key_size: int = 4096,
) -> ReleaseKey:
    """Create a production PKCS#12 keystore (same format keytool emits today)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, country),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, org_unit),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ]
    )
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=365 * years + years // 4))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .sign(key, hashes.SHA256())
    )
    blob = pkcs12.serialize_key_and_certificates(
        name=alias.encode(),
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(password),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(blob)
    os.chmod(path, 0o600)
    return ReleaseKey(key, cert, alias)


def load_release_keystore(path: Path, password: bytes, alias: str) -> ReleaseKey:
    key, cert, _ = pkcs12.load_key_and_certificates(path.read_bytes(), password)
    if key is None or cert is None:
        raise ValueError(f"{path} has no key/cert pair")
    return ReleaseKey(key, cert, alias)


# --------------------------------------------------------------------------
# v1 (JAR) signing
# --------------------------------------------------------------------------
def _wrap72(line: str) -> str:
    if len(line) <= 72:
        return line + "\r\n"
    out = [line[:72] + "\r\n"]
    rest = line[72:]
    while rest:
        out.append(" " + rest[:71] + "\r\n")
        rest = rest[71:]
    return "".join(out)


def _jar_digest(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")


def build_jar_manifest(files: list[tuple[str, bytes]], created_by: str):
    header = f"Manifest-Version: 1.0\r\nCreated-By: {created_by}\r\n\r\n"
    sections, sf_sections = [], []
    for name, data in files:
        section = _wrap72(f"Name: {name}") + _wrap72(f"SHA-256-Digest: {_jar_digest(data)}") + "\r\n"
        sections.append(section)
        sf_sections.append(
            _wrap72(f"Name: {name}")
            + _wrap72(f"SHA-256-Digest: {_jar_digest(section.encode('utf-8'))}")
            + "\r\n"
        )
    mf = (header + "".join(sections)).encode("utf-8")
    sf_header = (
        _wrap72("Signature-Version: 1.0")
        + _wrap72(f"Created-By: {created_by}")
        + _wrap72(f"SHA-256-Digest-Manifest: {_jar_digest(mf)}")
        + "\r\n"
    )
    return mf, (sf_header + "".join(sf_sections)).encode("utf-8")


def pkcs7_sign(sf: bytes, rk: ReleaseKey) -> bytes:
    return (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(sf)
        .add_signer(rk.cert, rk.key, hashes.SHA256())
        .sign(
            serialization.Encoding.DER,
            [
                pkcs7.PKCS7Options.DetachedSignature,
                pkcs7.PKCS7Options.Binary,
                pkcs7.PKCS7Options.NoCapabilities,
            ],
        )
    )


# --------------------------------------------------------------------------
# Aligned zip writer
# --------------------------------------------------------------------------
def _deflate(data: bytes) -> bytes:
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(data) + c.flush()


class AlignedZip:
    def __init__(self):
        self.buf = bytearray()
        self.central: list[bytes] = []

    def add(self, name: str, data: bytes, *, stored: bool, date_time, align=DEFAULT_ALIGN, flag_bits=0):
        name_b = name.encode("utf-8")
        method = 0 if stored else 8
        payload = data if stored else _deflate(data)
        crc = zlib.crc32(data) & 0xFFFFFFFF
        extra = b""
        if stored and align:
            data_off = len(self.buf) + 30 + len(name_b)
            pad = (align - (data_off % align)) % align
            if pad and pad < 4:
                pad += align
            if pad:
                extra = struct.pack("<HH", 0x0000, pad - 4) + b"\x00" * (pad - 4)

        dt = date_time
        dos_time = (dt[3] << 11) | (dt[4] << 5) | (dt[5] // 2)
        dos_date = ((dt[0] - 1980) << 9) | (dt[1] << 5) | dt[2]
        flags = flag_bits & ~0x08
        if any(b > 127 for b in name_b):
            flags |= 1 << 11

        local = struct.pack(
            "<IHHHHHIIIHH", 0x04034B50, 20, flags, method, dos_time, dos_date,
            crc, len(payload), len(data), len(name_b), len(extra),
        )
        offset = len(self.buf)
        self.buf += local + name_b + extra + payload
        cd = struct.pack(
            "<IHHHHHHIIIHHHHHII", 0x02014B50, 0x0317, 20, flags, method, dos_time,
            dos_date, crc, len(payload), len(data), len(name_b), 0, 0, 0, 0, 0, offset,
        )
        self.central.append(cd + name_b)

    def finish(self) -> bytes:
        cd_off = len(self.buf)
        cd = b"".join(self.central)
        self.buf += cd
        self.buf += struct.pack(
            "<IHHHHIIH", 0x06054B50, 0, 0, len(self.central), len(self.central),
            len(cd), cd_off, 0,
        )
        return bytes(self.buf)


# --------------------------------------------------------------------------
# v2 / v3 signing
# --------------------------------------------------------------------------
def _chunked_digest(*sections: bytes) -> bytes:
    digests = []
    for data in sections:
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


def _u32pref(data: bytes) -> bytes:
    return struct.pack("<I", len(data)) + data


def find_eocd(apk: bytes) -> int:
    max_scan = min(len(apk) - 22, 65535)
    for i in range(len(apk) - 22, len(apk) - 22 - max_scan - 1, -1):
        if apk[i : i + 4] == b"PK\x05\x06":
            comment_len = struct.unpack_from("<H", apk, i + 20)[0]
            if i + 22 + comment_len == len(apk):
                return i
    raise ValueError("EOCD not found")


def _pair(block_id: int, value: bytes) -> bytes:
    pair = struct.pack("<I", block_id) + value
    return struct.pack("<Q", len(pair)) + pair


def sign_v2_v3(apk: bytes, rk: ReleaseKey) -> bytes:
    eocd_off = find_eocd(apk)
    cd_size = struct.unpack_from("<I", apk, eocd_off + 12)[0]
    cd_off = struct.unpack_from("<I", apk, eocd_off + 16)[0]
    contents = apk[:cd_off]
    cd = apk[cd_off : cd_off + cd_size]
    eocd = bytearray(apk[eocd_off:])

    eocd_for_digest = bytearray(eocd)
    struct.pack_into("<I", eocd_for_digest, 16, len(contents))
    digest = _chunked_digest(bytes(contents), bytes(cd), bytes(eocd_for_digest))

    cert_der = rk.cert.public_bytes(serialization.Encoding.DER)
    pub_der = rk.key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    digest_seq = _u32pref(_u32pref(struct.pack("<I", SIG_ALGO_RSA_PKCS1_SHA256) + _u32pref(digest)))
    cert_seq = _u32pref(_u32pref(cert_der))

    strip_attr = struct.pack("<II", STRIPPING_PROTECTION_ATTR_ID, 3)
    v2_signed = digest_seq + cert_seq + _u32pref(_u32pref(strip_attr))
    v2_sig = rk.key.sign(v2_signed, padding.PKCS1v15(), hashes.SHA256())
    v2_signer = (
        _u32pref(v2_signed)
        + _u32pref(_u32pref(struct.pack("<I", SIG_ALGO_RSA_PKCS1_SHA256) + _u32pref(v2_sig)))
        + _u32pref(pub_der)
    )
    v2_value = _u32pref(_u32pref(v2_signer))

    v3_signed = digest_seq + cert_seq + struct.pack("<II", MIN_SDK, MAX_SDK) + _u32pref(b"")
    v3_sig = rk.key.sign(v3_signed, padding.PKCS1v15(), hashes.SHA256())
    v3_signer = (
        _u32pref(v3_signed)
        + struct.pack("<II", MIN_SDK, MAX_SDK)
        + _u32pref(_u32pref(struct.pack("<I", SIG_ALGO_RSA_PKCS1_SHA256) + _u32pref(v3_sig)))
        + _u32pref(pub_der)
    )
    v3_value = _u32pref(_u32pref(v3_signer))

    pairs = _pair(V2_BLOCK_ID, v2_value) + _pair(V3_BLOCK_ID, v3_value)
    magic = b"APK Sig Block 42"

    def build(pb: bytes) -> bytes:
        size = len(pb) + 8 + 16
        return struct.pack("<Q", size) + pb + struct.pack("<Q", size) + magic

    block = build(pairs)
    pad = (PAGE_ALIGN - (len(block) % PAGE_ALIGN)) % PAGE_ALIGN
    if pad:
        if pad < 12:
            pad += PAGE_ALIGN
        pairs += _pair(VERITY_PADDING_BLOCK_ID, b"\x00" * (pad - 12))
        block = build(pairs)

    eocd_out = bytearray(eocd)
    struct.pack_into("<I", eocd_out, 16, len(contents) + len(block))
    return bytes(contents) + block + bytes(cd) + bytes(eocd_out)


def is_signature_file(name: str) -> bool:
    if not name.startswith("META-INF/"):
        return False
    upper = name.upper()
    return (
        upper.endswith((".SF", ".RSA", ".DSA", ".EC"))
        or name.split("/")[-1].upper() == "MANIFEST.MF"
    )


def repackage_and_sign(
    src_apk: Path,
    out_apk: Path,
    rk: ReleaseKey,
    replacements: dict[str, bytes],
    created_by: str = "CardWallet release pipeline",
) -> dict:
    """Rebuild src_apk with `replacements` applied, then v1+v2+v3-sign it."""
    src = zipfile.ZipFile(src_apk)
    entries: list[tuple[zipfile.ZipInfo, bytes]] = []
    replaced: list[str] = []
    for info in src.infolist():
        if info.is_dir() or is_signature_file(info.filename):
            continue
        if info.filename in replacements:
            data = replacements[info.filename]
            replaced.append(info.filename)
        else:
            data = src.read(info.filename)
        entries.append((info, data))
    src.close()

    missing = set(replacements) - set(replaced)
    if missing:
        raise KeyError(f"replacement targets not present in APK: {sorted(missing)}")

    mf, sf = build_jar_manifest([(i.filename, d) for i, d in entries], created_by)
    rsa_block = pkcs7_sign(sf, rk)

    z = AlignedZip()
    for info, data in entries:
        stored = info.compress_type == zipfile.ZIP_STORED
        z.add(
            info.filename, data, stored=stored, date_time=info.date_time,
            align=DEFAULT_ALIGN if stored else 0, flag_bits=info.flag_bits,
        )
    now = datetime.now().timetuple()[:6]
    z.add("META-INF/MANIFEST.MF", mf, stored=False, date_time=now, align=0)
    z.add("META-INF/CERT.SF", sf, stored=False, date_time=now, align=0)
    z.add("META-INF/CERT.RSA", rsa_block, stored=False, date_time=now, align=0)

    signed = sign_v2_v3(z.finish(), rk)
    out_apk.parent.mkdir(parents=True, exist_ok=True)
    out_apk.write_bytes(signed)
    return {
        "entries": len(entries) + 3,
        "replaced": replaced,
        "size": len(signed),
        "sha256": hashlib.sha256(signed).hexdigest(),
    }
