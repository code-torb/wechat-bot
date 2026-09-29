import time
import unittest

from .protocol import canonical, sign, verify


class ProtocolTest(unittest.TestCase):
    def test_sign_and_verify(self):
        payload = {"id": "1", "action": "read", "expiresAt": int(time.time()) + 10}
        payload["signature"] = sign(payload, "secret")
        self.assertTrue(verify(payload, "secret"))

    def test_tampered_or_expired_rejected(self):
        payload = {"id": "1", "action": "read", "expiresAt": int(time.time()) + 10}
        payload["signature"] = sign(payload, "secret")
        tampered = dict(payload, action="commit_write")
        with self.assertRaises(ValueError):
            verify(tampered, "secret")
        expired = dict(payload, expiresAt=int(time.time()) - 30)
        with self.assertRaises(ValueError):
            verify(expired, "secret")

    def test_canonical_is_deterministic(self):
        self.assertEqual(canonical({"b": 1, "a": 2}), '{"a":2,"b":1}')


if __name__ == "__main__":
    unittest.main()
