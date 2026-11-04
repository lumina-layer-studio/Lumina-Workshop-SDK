"""Operation registry, task context, and the protocol v1 serve loop."""

from __future__ import annotations

import os
import queue
import re
import sys
import threading
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ._channel import ChannelError, ControlChannel

SDK_NAME = "lumina-workshop-backend"
SDK_VERSION = "1.1.0"
_OPERATION = re.compile(r"^[a-z][a-z0-9.-]{0,63}$")
_ERROR_CODE = re.compile(r"^[a-z0-9][a-z0-9.-]{0,79}$")
_OUTPUT_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$")
_MIME_TYPE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$")
_PROGRESS_INTERVAL_SECONDS = 0.05


class TaskCancelled(Exception):
    """Raised by :meth:`TaskContext.check_cancelled` after a cancel request."""


class TaskFailure(Exception):
    """A handled failure with a stable kebab-case code shown to the module UI.

    Messages must not contain stack traces, local paths, or tokens.
    """

    def __init__(self, code: str, message: str) -> None:
        if _ERROR_CODE.fullmatch(code) is None:
            raise ValueError("error code must be stable kebab-case")
        super().__init__(message)
        self.code = code
        self.message = message[:500]


@dataclass(frozen=True)
class TaskInput:
    name: str
    path: Path
    file_name: str
    mime_type: str

    def read_bytes(self) -> bytes:
        return self.path.read_bytes()


@dataclass(frozen=True)
class OutputFile:
    name: str
    file_name: str
    mime_type: str


@dataclass
class TaskContext:
    """Everything one task may use; files stay inside host task folders."""

    task_id: str
    operation: str
    params: dict[str, Any]
    inputs: dict[str, TaskInput]
    models: dict[str, Path]
    work_dir: Path
    output_dir: Path
    variant: str
    _send: Callable[[dict[str, Any]], None]
    _is_cancelled: Callable[[], bool]
    _outputs: list[OutputFile] = field(default_factory=list)
    _last_progress: float = 0.0

    @property
    def cancelled(self) -> bool:
        return self._is_cancelled()

    def check_cancelled(self) -> None:
        """Raise :class:`TaskCancelled` if the host asked to cancel."""

        if self._is_cancelled():
            raise TaskCancelled()

    def progress(self, completed: float, total: float, phase: str = "") -> None:
        """Report progress; the host keeps only the latest value."""

        if total < 0 or completed < 0 or completed > total:
            raise ValueError("progress must satisfy 0 <= completed <= total")
        now = time.monotonic()
        if now - self._last_progress < _PROGRESS_INTERVAL_SECONDS and completed < total:
            return
        self._last_progress = now
        self._send(
            {
                "type": "progress",
                "taskId": self.task_id,
                "completed": completed,
                "total": total,
                "phase": phase[:200],
            }
        )

    def output_path(self, file_name: str) -> Path:
        """Path for an output file inside the task output folder."""

        if _FILE_NAME.fullmatch(file_name) is None or file_name.endswith((".", " ")):
            raise ValueError("output file name must be one safe file name")
        return self.output_dir / file_name

    def add_output(self, name: str, file_name: str, mime_type: str) -> None:
        """Declare an output already written to :meth:`output_path`."""

        if _OUTPUT_NAME.fullmatch(name) is None or any(item.name == name for item in self._outputs):
            raise ValueError("output name must be unique and safe")
        if _MIME_TYPE.fullmatch(mime_type) is None:
            raise ValueError("output MIME type is invalid")
        if not self.output_path(file_name).is_file():
            raise ValueError("declared output file does not exist")
        self._outputs.append(OutputFile(name=name, file_name=file_name, mime_type=mime_type))

    def write_output(self, name: str, file_name: str, mime_type: str, data: bytes) -> Path:
        path = self.output_path(file_name)
        path.write_bytes(data)
        self.add_output(name, file_name, mime_type)
        return path


Handler = Callable[[TaskContext], None]


class Backend:
    """Register operations and serve host tasks one at a time.

    ``backend = Backend()``, decorate handlers with ``@backend.operation(...)``,
    and call ``backend.serve()`` under ``if __name__ == "__main__":``.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()

    def operation(self, name: str) -> Callable[[Handler], Handler]:
        if _OPERATION.fullmatch(name) is None:
            raise ValueError("operation names are lowercase kebab-case")

        def register(handler: Handler) -> Handler:
            if name in self._handlers:
                raise ValueError(f"operation {name!r} is already registered")
            self._handlers[name] = handler
            return handler

        return register

    @property
    def operations(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))

    def _is_cancelled(self, task_id: str) -> bool:
        with self._lock:
            return task_id in self._cancelled

    def _context(self, message: dict[str, Any], send: Callable[[dict[str, Any]], None]) -> TaskContext:
        task_id = str(message["taskId"])
        return TaskContext(
            task_id=task_id,
            operation=str(message["operation"]),
            params=dict(message.get("params") or {}),
            inputs={
                str(item["name"]): TaskInput(
                    name=str(item["name"]),
                    path=Path(item["path"]),
                    file_name=str(item["fileName"]),
                    mime_type=str(item["mimeType"]),
                )
                for item in message.get("inputs") or []
            },
            models={str(key): Path(value) for key, value in (message.get("models") or {}).items()},
            work_dir=Path(message["workDir"]),
            output_dir=Path(message["outputDir"]),
            variant=str(message.get("variant") or "cpu"),
            _send=send,
            _is_cancelled=lambda: self._is_cancelled(task_id),
        )

    def run_task(self, message: dict[str, Any], send: Callable[[dict[str, Any]], None]) -> None:
        """Execute one ``run`` message and report exactly one outcome."""

        task_id = str(message.get("taskId"))
        handler = self._handlers.get(str(message.get("operation")))
        if handler is None:
            send({"type": "error", "taskId": task_id, "code": "unknown-operation", "message": "This backend does not provide that operation."})
            return
        context = self._context(message, send)
        try:
            context.check_cancelled()
            handler(context)
            context.check_cancelled()
        except TaskCancelled:
            send({"type": "cancelled", "taskId": task_id})
        except TaskFailure as failure:
            send({"type": "error", "taskId": task_id, "code": failure.code, "message": failure.message})
        except Exception:  # noqa: BLE001 - one outcome per task
            traceback.print_exc(file=sys.stderr)
            send({"type": "error", "taskId": task_id, "code": "backend-exception", "message": "The backend failed while running the task."})
        else:
            send(
                {
                    "type": "result",
                    "taskId": task_id,
                    "outputs": [
                        {"name": item.name, "fileName": item.file_name, "mimeType": item.mime_type}
                        for item in context._outputs
                    ],
                }
            )
        finally:
            with self._lock:
                self._cancelled.discard(task_id)

    def serve(self) -> None:
        """Run until the host shuts the backend down or disconnects."""

        channel = ControlChannel.from_environment()
        jobs: queue.Queue[object] = queue.Queue()

        def read() -> None:
            try:
                for message in channel.messages():
                    kind = message["type"]
                    if kind == "run":
                        jobs.put(message)
                    elif kind == "cancel":
                        with self._lock:
                            self._cancelled.add(str(message.get("taskId")))
                    elif kind == "shutdown":
                        break
            except (ChannelError, OSError, ValueError):
                pass
            # The host is gone or asked to stop: nobody can receive further
            # results, so exit without waiting for a running handler.
            for stream in (sys.stdout, sys.stderr):
                try:
                    stream.flush()
                except (OSError, ValueError):
                    pass
            os._exit(0)

        channel.send(
            {
                "type": "ready",
                "protocol": 1,
                "sdk": {"name": SDK_NAME, "version": SDK_VERSION},
                "operations": list(self.operations),
            }
        )
        threading.Thread(target=read, name="lumina-control-reader", daemon=True).start()
        while True:
            job = jobs.get()
            assert isinstance(job, dict)
            self.run_task(job, channel.send)
