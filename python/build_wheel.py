"""Build the pure-Python backend SDK wheel reproducibly (stdlib only).

Usage: python python/build_wheel.py --output dist-package
Writes <name>-<version>-py3-none-any.whl and a lowercase .sha256 file.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "src" / "lumina_workshop_backend"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def _record_hash(data: bytes) -> str:
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def build(output: Path) -> Path:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    name = project["name"].replace("-", "_")
    version = project["version"]
    dist_info = f"{name}-{version}.dist-info"
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    entries: dict[str, bytes] = {}
    for path in sorted(SOURCE.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            entries[f"lumina_workshop_backend/{path.relative_to(SOURCE).as_posix()}"] = path.read_bytes()
    entries[f"{dist_info}/LICENSE"] = (ROOT.parent / "LICENSE").read_bytes()
    entries[f"{dist_info}/METADATA"] = (
        "Metadata-Version: 2.1\n"
        f"Name: {project['name']}\n"
        f"Version: {version}\n"
        f"Summary: {project['description']}\n"
        f"License: {project['license']}\n"
        f"Requires-Python: {project['requires-python']}\n"
        "Description-Content-Type: text/markdown\n\n"
        f"{readme}"
    ).encode("utf-8")
    entries[f"{dist_info}/WHEEL"] = (
        "Wheel-Version: 1.0\nGenerator: lumina-build-wheel\nRoot-Is-Purelib: true\nTag: py3-none-any\n"
    ).encode("utf-8")
    record = [f"{member},{_record_hash(data)},{len(data)}" for member, data in entries.items()]
    record.append(f"{dist_info}/RECORD,,")
    entries[f"{dist_info}/RECORD"] = ("\n".join(record) + "\n").encode("utf-8")
    output.mkdir(parents=True, exist_ok=True)
    wheel = output / f"{name}-{version}-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for member, data in entries.items():
            info = zipfile.ZipInfo(member, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
    (output / f"{wheel.name}.sha256").write_text(f"{digest}  {wheel.name}\n", encoding="utf-8")
    return wheel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT.parent / "dist-package")
    arguments = parser.parse_args()
    print(build(arguments.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
