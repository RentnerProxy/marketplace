import json
from pathlib import Path
import stat
import sys
import zipfile


def extract(archive, destination, limits):
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) != len(limits) or {entry.filename for entry in entries} != set(limits):
            raise ValueError("Invalid candidate ZIP entry set")

        for entry in entries:
            name = entry.filename
            if (
                entry.orig_filename != name
                or not name.isascii()
                or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-" for character in name)
                or name in {".", ".."}
                or entry.is_dir()
                or entry.flag_bits & 1
                or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG)
                or not 0 < entry.file_size <= limits[name]
            ):
                raise ValueError("Invalid candidate ZIP member")

            remaining = entry.file_size
            with bundle.open(entry) as source, (destination / name).open("xb") as target:
                while chunk := source.read(min(remaining + 1, 64 * 1024)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError("Candidate ZIP member exceeds its declared size")
                    target.write(chunk)
            if remaining:
                raise ValueError("Candidate ZIP member was truncated")


if __name__ == "__main__":
    extract(sys.argv[1], Path(sys.argv[2]), json.loads(sys.argv[3]))
