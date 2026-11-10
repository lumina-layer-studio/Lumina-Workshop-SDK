"""Control channel: newline-delimited JSON over two host descriptors."""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from typing import Any, BinaryIO

MAX_MESSAGE_BYTES = 1024 * 1024
CONTROL_FDS_VARIABLE = "LUMINA_WORKSHOP_CONTROL_FDS"


class ChannelError(RuntimeError):
    """The backend was not started by a Lumina host or the channel broke."""


class ControlChannel:
    """Thread-safe writer and blocking reader for protocol v1 messages."""

    def __init__(self, reader: BinaryIO, writer: BinaryIO) -> None:
        self._reader = reader
        self._writer = writer
        self._lock = threading.Lock()

    @classmethod
    def from_environment(cls) -> "ControlChannel":
        raw = os.environ.get(CONTROL_FDS_VARIABLE, "")
        try:
            read_fd, write_fd = (int(part) for part in raw.split(","))
        except ValueError as exc:
            raise ChannelError(
                "This backend must be started by Lumina Studio "
                f"({CONTROL_FDS_VARIABLE} is missing)."
            ) from exc
        # Helper processes started by the module must not keep the channel
        # open after this backend exits.
        os.set_inheritable(read_fd, False)
        os.set_inheritable(write_fd, False)
        return cls(os.fdopen(read_fd, "rb"), os.fdopen(write_fd, "wb", buffering=0))

    def send(self, message: dict[str, Any]) -> None:
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(payload) + 1 > MAX_MESSAGE_BYTES:
            raise ChannelError("control message exceeds 1 MiB")
        with self._lock:
            self._writer.write(payload + b"\n")

    def messages(self) -> Iterator[dict[str, Any]]:
        """Yield host messages until the host closes the channel."""

        while True:
            line = self._reader.readline(MAX_MESSAGE_BYTES + 1)
            if not line:
                return
            if not line.endswith(b"\n"):
                raise ChannelError("control message exceeds 1 MiB")
            value = json.loads(line.decode("utf-8"))
            if isinstance(value, dict) and isinstance(value.get("type"), str):
                yield value
