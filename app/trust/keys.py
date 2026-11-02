"""The service's signing key. One Ed25519 key signs each pledge's terms and the limits a person sets; its public half is
published as a JWKS (GET /api/keys), so anyone can check a signature without trusting this server's database.

SIGNING_KEY is the key's 32-byte seed in base64. Without it the key lives only as long as the process, which is fine for
development and wrong for a hosted site: the app then refuses to prepare pledges rather than sign what it cannot later
prove (app.routes.campaigns)."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

RAW = serialization.Encoding.Raw, serialization.PublicFormat.Raw


def b64(data: bytes) -> str:
    """URL-safe base64 without padding, the form JWS and JWKS use."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64(text: str) -> bytes:
    """The bytes of URL-safe base64, with or without padding; ValueError when it is not base64."""
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Not base64.") from exc


def canonical(value: Any) -> bytes:
    """The one byte string a document is hashed and signed as: sorted keys, no spaces, UTF-8."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(value: Any) -> str:
    """The SHA-256 of a document's canonical form, in hex."""
    return hashlib.sha256(canonical(value)).hexdigest()


class Signer:
    """The key, the signatures it makes and the public key that checks them."""

    def __init__(self, key: Ed25519PrivateKey, persistent: bool) -> None:
        self.key = key
        self.persistent = persistent
        self.public: Ed25519PublicKey = key.public_key()
        raw = self.public.public_bytes(*RAW)
        self.kid = hashlib.sha256(raw).hexdigest()[:16]
        self._x = b64(raw)

    @classmethod
    def load(cls, seed: str = "") -> Signer:
        """The key SIGNING_KEY names, or, when it is empty, a new key that is gone with the process."""
        if not seed.strip():
            return cls(Ed25519PrivateKey.generate(), persistent=False)
        raw = unb64(seed.strip())
        if len(raw) != 32:
            raise ValueError("SIGNING_KEY must be 32 bytes in base64 (an Ed25519 seed).")
        return cls(Ed25519PrivateKey.from_private_bytes(raw), persistent=True)

    @staticmethod
    def new_seed() -> str:
        """A fresh seed to set as SIGNING_KEY."""
        return b64(Ed25519PrivateKey.generate().private_bytes(
            serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption(),
        ))

    def sign(self, data: bytes) -> str:
        return b64(self.key.sign(data))

    def verify(self, data: bytes, signature: str) -> bool:
        try:
            self.public.verify(unb64(signature), data)
        except (InvalidSignature, ValueError):
            return False
        return True

    def jwks(self) -> dict:
        """The public key as a JSON Web Key Set (RFC 7517, with the Ed25519 key type of RFC 8037)."""
        return {"keys": [{"kty": "OKP", "crv": "Ed25519", "x": self._x, "kid": self.kid, "use": "sig", "alg": "EdDSA"}]}
