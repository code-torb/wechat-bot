import os


def open_root(root):
    return os.open(root, os.O_RDONLY | os.O_DIRECTORY)


def open_relative(root_fd, relative, create=False, write=False):
    """Open a file relative to root_fd without following symlinks at any level."""
    if relative.startswith("/") or ".." in relative.split("/") or not relative:
        raise ValueError("unsafe relative path")
    parts = relative.split("/")
    fd = root_fd
    parent_fd = root_fd
    parent_owned = False
    for part in parts[:-1]:
        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        if parent_owned:
            os.close(parent_fd)
        fd = child
        parent_fd = child
        parent_owned = True
    flags = os.O_RDONLY
    if write:
        flags = os.O_RDWR | os.O_CREAT
        if not create:
            flags = os.O_RDWR
    try:
        return os.open(parts[-1], flags | os.O_NOFOLLOW, dir_fd=fd), parent_fd, parent_owned
    except FileNotFoundError:
        raise ValueError("file not found")


def stat_relative(root_fd, relative):
    fd, parent_fd, parent_owned = open_relative(root_fd, relative)
    try:
        return os.fstat(fd), fd, parent_fd, parent_owned
    except Exception:
        os.close(fd)
        if parent_owned:
            os.close(parent_fd)
        raise


def list_relative(root_fd, relative):
    fd, parent_fd, parent_owned = open_relative(root_fd, relative if relative else ".")
    try:
        entries = []
        with os.scandir(fd) as it:
            for entry in it:
                if entry.is_dir():
                    kind = "dir"
                elif entry.is_file():
                    kind = "file"
                else:
                    kind = "other"
                entries.append({"name": entry.name, "kind": kind})
        return entries
    finally:
        os.close(fd)
        if parent_owned:
            os.close(parent_fd)
