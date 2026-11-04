"""Public Python SDK for Lumina Studio Creative Workshop module backends.

A module backend registers operations and calls :meth:`Backend.serve`. The
host owns tasks, files, and the process lifecycle; the SDK speaks control
protocol v1 over the dedicated channel the host provides.

Lumina Studio 创意工坊模块后端的公开 Python SDK。
"""

from ._backend import (
    Backend,
    OutputFile,
    TaskCancelled,
    TaskContext,
    TaskFailure,
    TaskInput,
)

__version__ = "1.1.0"
PROTOCOL_VERSION = 1

__all__ = [
    "Backend",
    "OutputFile",
    "PROTOCOL_VERSION",
    "TaskCancelled",
    "TaskContext",
    "TaskFailure",
    "TaskInput",
    "__version__",
]
