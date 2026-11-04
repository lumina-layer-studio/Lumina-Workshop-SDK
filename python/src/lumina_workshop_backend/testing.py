"""Run backend operations in-process for module unit tests (no host needed)."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ._backend import Backend


@dataclass(frozen=True)
class OperationResult:
    status: str
    outputs: dict[str, Path]
    error_code: str | None
    progress: list[tuple[float, float, str]]


def run_operation(
    backend: Backend,
    operation: str,
    *,
    params: dict[str, Any] | None = None,
    inputs: dict[str, tuple[bytes, str, str]] | None = None,
    models: dict[str, Path] | None = None,
    variant: str = "cpu",
    work_root: Path | None = None,
    cancel_after_progress: int | None = None,
) -> OperationResult:
    """Execute one operation like the host does and collect its outcome.

    ``inputs`` maps names to ``(bytes, file_name, mime_type)``.
    """

    root = Path(work_root) if work_root is not None else Path(tempfile.mkdtemp(prefix="lumina-backend-test-"))
    (root / "inputs").mkdir(parents=True, exist_ok=True)
    (root / "outputs").mkdir(exist_ok=True)
    (root / "work").mkdir(exist_ok=True)
    messages: list[dict[str, Any]] = []
    task_id = "0" * 32

    def send(message: dict[str, Any]) -> None:
        messages.append(message)
        if (
            cancel_after_progress is not None
            and message["type"] == "progress"
            and sum(1 for item in messages if item["type"] == "progress") >= cancel_after_progress
        ):
            backend._cancelled.add(task_id)  # noqa: SLF001 - simulate the host

    run_inputs = []
    for name, (data, file_name, mime_type) in (inputs or {}).items():
        path = root / "inputs" / file_name
        path.write_bytes(data)
        run_inputs.append({"name": name, "path": str(path), "fileName": file_name, "mimeType": mime_type})
    backend.run_task(
        {
            "type": "run",
            "taskId": task_id,
            "operation": operation,
            "params": params or {},
            "inputs": run_inputs,
            "outputDir": str(root / "outputs"),
            "workDir": str(root / "work"),
            "models": {key: str(value) for key, value in (models or {}).items()},
            "variant": variant,
        },
        send,
    )
    final = messages[-1]
    progress = [(item["completed"], item["total"], item["phase"]) for item in messages if item["type"] == "progress"]
    if final["type"] == "result":
        return OperationResult(
            status="succeeded",
            outputs={item["name"]: root / "outputs" / item["fileName"] for item in final["outputs"]},
            error_code=None,
            progress=progress,
        )
    if final["type"] == "cancelled":
        return OperationResult(status="cancelled", outputs={}, error_code=None, progress=progress)
    return OperationResult(status="failed", outputs={}, error_code=final.get("code"), progress=progress)
