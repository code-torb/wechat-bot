import hashlib
import os
import uuid

from .paths import open_relative, stat_relative, list_relative


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def list_op(root_fd, relative):
    return {"entries": list_relative(root_fd, relative)}


def read_op(root_fd, relative, max_bytes=10 * 1024 * 1024):
    st, fd, parent_fd, parent_owned = stat_relative(root_fd, relative)
    try:
        if st.st_size > max_bytes:
            raise ValueError("file too large")
        return {"content": os.read(fd, st.st_size + 1).decode("utf-8"), "size": st.st_size}
    finally:
        os.close(fd)
        if parent_owned:
            os.close(parent_fd)


def prepare_write(root_fd, relative, content, expected_hash):
    existing = None
    try:
        st, fd, parent_fd, parent_owned = stat_relative(root_fd, relative)
        try:
            existing = os.read(fd, st.st_size + 1).decode("utf-8")
        finally:
            os.close(fd)
            if parent_owned:
                os.close(parent_fd)
        if sha256_bytes(existing.encode()) != expected_hash:
            raise ValueError("expected file hash mismatch")
    except ValueError as exc:
        if "not found" not in str(exc) and "file too large" not in str(exc):
            raise
        if expected_hash:
            raise ValueError("expected file hash mismatch for missing file")
    return {"prepared": True, "existingHash": sha256_bytes(existing.encode()) if existing is not None else None}


def commit_write(root_fd, relative, content, expected_hash):
    try:
        st, fd, parent_fd, parent_owned = stat_relative(root_fd, relative)
        try:
            existing = os.read(fd, st.st_size + 1).decode("utf-8")
        finally:
            os.close(fd)
            if parent_owned:
                os.close(parent_fd)
        if sha256_bytes(existing.encode()) != expected_hash:
            raise ValueError("expected file hash mismatch")
    except ValueError as exc:
        if "file too large" in str(exc):
            raise
        if expected_hash and "not found" not in str(exc):
            raise
        if expected_hash:
            raise ValueError("expected file hash mismatch for missing file")
    target_fd, parent_fd, parent_owned = open_relative(root_fd, relative, create=True, write=True)
    tmp_name = ".tmp-" + uuid.uuid4().hex
    try:
        tmp_fd = os.open(tmp_name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        os.write(tmp_fd, content.encode("utf-8"))
        os.fsync(tmp_fd)
        os.close(tmp_fd)
        os.replace(tmp_name, relative.split("/")[-1], src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
    finally:
        try:
            os.close(target_fd)
        except OSError:
            pass
        try:
            os.unlink(tmp_name, dir_fd=parent_fd)
        except OSError:
            pass
        if parent_owned:
            os.close(parent_fd)
    return {"committed": True, "resultHash": sha256_bytes(content.encode())}
