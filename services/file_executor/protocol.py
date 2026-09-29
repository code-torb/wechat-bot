import hashlib
import hmac
import json
import time


def canonical(payload):
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign(payload, secret):
    return hmac.new(secret.encode(), canonical(payload).encode(), hashlib.sha256).hexdigest()


def verify(payload, secret, tolerance_seconds=10):
    unsigned = {key: value for key, value in payload.items() if key != "signature"}
    if payload.get("signature") != sign(unsigned, secret):
        raise ValueError("bad signature")
    expires = payload.get("expiresAt")
    if not isinstance(expires, int) or expires <= 0:
        raise ValueError("bad expiry")
    if time.time() > expires + tolerance_seconds:
        raise ValueError("expired request")
    return True
