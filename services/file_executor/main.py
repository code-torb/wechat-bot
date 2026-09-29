import json
import os
import socket
import sys

from .journal import Journal
from .operations import list_op, read_op, prepare_write, commit_write
from .paths import open_root
from .protocol import verify


SOCKET_PATH = os.environ.get("EXECUTOR_SOCKET", "/run/file-executor.sock")
SECRET = os.environ.get("EXECUTOR_SECRET", "")
JOURNAL_PATH = os.environ.get("EXECUTOR_JOURNAL", "/var/lib/file-executor/journal.jsonl")
MAX_BODY = 1024 * 1024


def manifest():
    result = {}
    for item in os.environ.get("RESOURCE_MANIFEST", "").split(","):
        if not item:
            continue
        alias, root = item.split("=", 1)
        result[alias] = root
    return result


def handle(payload):
    verify(payload, SECRET)
    resources = manifest()
    resource_id = payload.get("resourceId")
    root = resources.get(resource_id)
    if not root:
        return {"id": payload.get("id"), "status": "denied", "errorCode": "RESOURCE_UNKNOWN"}
    if not os.path.isdir(root):
        return {"id": payload.get("id"), "status": "failed", "errorCode": "RESOURCE_MISSING"}
    action = payload.get("action")
    relative = payload.get("relativePath")
    root_fd = open_root(root)
    try:
        if action == "list":
            return {"id": payload.get("id"), "status": "ok", "data": list_op(root_fd, relative)}
        if action == "read":
            return {"id": payload.get("id"), "status": "ok", "data": read_op(root_fd, relative)}
        if action == "prepare_write":
            result = prepare_write(root_fd, relative, payload.get("content", ""), payload.get("expectedHash") or "")
            return {"id": payload.get("id"), "status": "ok", "data": result}
        if action == "commit_write":
            result = commit_write(root_fd, relative, payload.get("content", ""), payload.get("expectedHash") or "")
            return {"id": payload.get("id"), "status": "ok", "data": result}
        return {"id": payload.get("id"), "status": "denied", "errorCode": "UNKNOWN_ACTION"}
    except ValueError as exc:
        return {"id": payload.get("id"), "status": "failed", "errorCode": "PATH_OR_STATE_ERROR", "message": str(exc)}
    finally:
        os.close(root_fd)


def serve():
    journal = Journal(JOURNAL_PATH)
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    os.chmod(SOCKET_PATH, 0o660)
    server.listen(1)
    while True:
        conn, _ = server.accept()
        with conn:
            data = b""
            while b"\n" not in data:
                chunk = conn.recv(MAX_BODY)
                if not chunk:
                    break
                data += chunk
            try:
                payload = json.loads(data.decode("utf-8"))
                response = handle(payload)
                journal.append({"id": payload.get("id"), "action": payload.get("action"), "status": response.get("status"), "errorCode": response.get("errorCode")})
            except Exception as exc:  # noqa: BLE001 - protocol errors must never crash the socket
                response = {"id": None, "status": "failed", "errorCode": "BAD_REQUEST", "message": str(exc)}
            conn.sendall((json.dumps(response) + "\n").encode())


if __name__ == "__main__":
    try:
        serve()
    except KeyboardInterrupt:
        sys.exit(0)
