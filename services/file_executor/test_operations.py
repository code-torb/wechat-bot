import os
import tempfile
import unittest

from .operations import list_op, read_op, prepare_write, commit_write
from .paths import open_root


class OperationsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.root_fd = open_root(self.dir)
        self.addCleanup(lambda: os.close(self.root_fd))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.dir, ignore_errors=True))

    def write(self, name, content):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(content)

    def test_list_and_read(self):
        self.write("a.txt", "hello")
        entries = list_op(self.root_fd, "")["entries"]
        self.assertIn("a.txt", [e["name"] for e in entries])
        self.assertEqual(read_op(self.root_fd, "a.txt")["content"], "hello")

    def test_path_traversal_and_absolute_rejected(self):
        for path in ["../secret", "/etc/passwd", "a/../../b"]:
            with self.assertRaises(ValueError):
                read_op(self.root_fd, path)

    def test_symlink_escape_rejected(self):
        os.symlink(os.path.join(self.dir, "..", "outside"), os.path.join(self.dir, "link"))
        with self.assertRaises(OSError):
            read_op(self.root_fd, "link")

    def test_commit_requires_expected_hash(self):
        import hashlib
        self.write("a.txt", "v1")
        with self.assertRaises(ValueError):
            commit_write(self.root_fd, "a.txt", "v2", "wrong")
        result = commit_write(self.root_fd, "a.txt", "v2", hashlib.sha256(b"v1").hexdigest())
        self.assertEqual(result["committed"], True)

    def test_prepare_matches_state(self):
        self.write("a.txt", "v1")
        result = prepare_write(self.root_fd, "a.txt", "v2", __import__("hashlib").sha256(b"v1").hexdigest())
        self.assertEqual(result["prepared"], True)


if __name__ == "__main__":
    unittest.main()
