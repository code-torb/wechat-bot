import json
import os


class Journal:
    def __init__(self, path):
        self.path = path
        if not os.path.exists(path):
            open(path, "a").close()

    def append(self, entry):
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
