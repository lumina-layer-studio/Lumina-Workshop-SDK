"""Contract tests for the Python backend SDK (stdlib unittest).

The end-to-end test launches a backend exactly as the documented host launch
contract does (docs/backend-protocol.md): two inherited control descriptors,
``python -I bootstrap.py <backend-dir> <entry>``.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))

from lumina_workshop_backend import Backend, TaskContext, TaskFailure  # noqa: E402
from lumina_workshop_backend.testing import run_operation  # noqa: E402

BOOTSTRAP = textwrap.dedent(
    '''
    import os, runpy, sys
    _read_ref, _write_ref = os.environ.pop("LUMINA_WORKSHOP_CONTROL").split(",")
    if os.name == "nt":
        import msvcrt
        _read_fd = msvcrt.open_osfhandle(int(_read_ref), os.O_RDONLY)
        _write_fd = msvcrt.open_osfhandle(int(_write_ref), os.O_WRONLY)
    else:
        _read_fd, _write_fd = int(_read_ref), int(_write_ref)
    os.set_inheritable(_read_fd, False)
    os.set_inheritable(_write_fd, False)
    os.environ["LUMINA_WORKSHOP_CONTROL_FDS"] = "%d,%d" % (_read_fd, _write_fd)
    _backend_dir, _entry = sys.argv[1], sys.argv[2]
    sys.path.insert(0, _backend_dir)
    sys.argv = [_entry]
    runpy.run_path(_entry, run_name="__main__")
    '''
)

MODULE_ENTRY = textwrap.dedent(
    '''
    import subprocess, sys, time
    from lumina_workshop_backend import Backend, TaskFailure

    backend = Backend()

    @backend.operation("echo")
    def echo(task):
        task.progress(1, 2, "half")
        task.write_output("echo", "echo.txt", "text/plain", repr(task.params).encode())

    @backend.operation("wait")
    def wait(task):
        helper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        task.write_output("pid", "pid.txt", "text/plain", str(helper.pid).encode())
        for step in range(400):
            task.check_cancelled()
            task.progress(step, 400, "waiting")
            time.sleep(0.02)

    @backend.operation("fail")
    def fail(task):
        raise TaskFailure("fixture-failure", "Failed on purpose.")

    if __name__ == "__main__":
        backend.serve()
    '''
)


def build_backend() -> Backend:
    backend = Backend()

    @backend.operation("double")
    def double(task: TaskContext) -> None:
        data = task.inputs["data"].read_bytes()
        task.progress(1, 1, "done")
        task.write_output("data", "out.bin", "application/octet-stream", data * 2)

    @backend.operation("slow")
    def slow(task: TaskContext) -> None:
        for step in range(10):
            task.progress(step, 10, "slow")
            task.check_cancelled()

    @backend.operation("fail")
    def fail(task: TaskContext) -> None:
        raise TaskFailure("bad-input", "Bad input.")

    @backend.operation("crash")
    def crash(task: TaskContext) -> None:
        raise RuntimeError("secret local path C:/Users/someone")

    return backend


class InProcessTests(unittest.TestCase):
    def test_success_failure_crash_cancel_and_unknown(self) -> None:
        backend = build_backend()
        with tempfile.TemporaryDirectory() as root:
            done = run_operation(backend, "double", inputs={"data": (b"ab", "in.bin", "application/octet-stream")}, work_root=Path(root) / "a")
            self.assertEqual(done.status, "succeeded")
            self.assertEqual(done.outputs["data"].read_bytes(), b"abab")
            self.assertEqual(run_operation(backend, "fail", work_root=Path(root) / "b").error_code, "bad-input")
            self.assertEqual(run_operation(backend, "crash", work_root=Path(root) / "c").error_code, "backend-exception")
            # Progress is throttled, so a tight loop reports its first step.
            cancelled = run_operation(backend, "slow", cancel_after_progress=1, work_root=Path(root) / "d")
            self.assertEqual(cancelled.status, "cancelled")
            self.assertEqual(len(cancelled.progress), 1)
            self.assertEqual(run_operation(backend, "missing", work_root=Path(root) / "e").error_code, "unknown-operation")

    def test_names_and_codes_are_validated(self) -> None:
        backend = Backend()
        with self.assertRaises(ValueError):
            backend.operation("Bad Name")
        with self.assertRaises(ValueError):
            TaskFailure("Not Kebab", "x")


class ProtocolTests(unittest.TestCase):
    def start(self, root: Path) -> tuple[subprocess.Popen[bytes], object, object]:
        (root / "backend").mkdir()
        entry = root / "backend" / "main.py"
        entry.write_text(MODULE_ENTRY, encoding="utf-8")
        bootstrap = root / "bootstrap.py"
        bootstrap.write_text(BOOTSTRAP, encoding="utf-8")
        host_read, child_write = os.pipe()
        child_read, host_write = os.pipe()
        os.set_inheritable(child_read, True)
        os.set_inheritable(child_write, True)
        env = {key: value for key, value in os.environ.items() if not key.startswith("PYTHON")}
        # The SDK under test stands in for a module's vendored or locked copy.
        command = [sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(SOURCE)!r}); exec(open({str(bootstrap)!r}).read())", str(root / "backend"), str(entry)]
        if os.name == "nt":
            import msvcrt

            handles = [msvcrt.get_osfhandle(child_read), msvcrt.get_osfhandle(child_write)]
            env["LUMINA_WORKSHOP_CONTROL"] = f"{handles[0]},{handles[1]}"
            info = subprocess.STARTUPINFO()
            info.lpAttributeList = {"handle_list": handles}
            process = subprocess.Popen(command, env=env, close_fds=True, startupinfo=info, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            env["LUMINA_WORKSHOP_CONTROL"] = f"{child_read},{child_write}"
            process = subprocess.Popen(command, env=env, close_fds=True, pass_fds=(child_read, child_write), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.close(child_read)
        os.close(child_write)
        return process, os.fdopen(host_read, "rb"), os.fdopen(host_write, "wb", buffering=0)

    @staticmethod
    def send(writer, message: dict) -> None:  # noqa: ANN001
        writer.write((json.dumps(message) + "\n").encode())

    @staticmethod
    def until(reader, kind: str) -> list[dict]:  # noqa: ANN001
        seen = []
        while True:
            line = reader.readline()
            if not line:
                raise AssertionError(f"channel closed before {kind}: {seen}")
            message = json.loads(line)
            seen.append(message)
            if message["type"] == kind:
                return seen

    def run_message(self, root: Path, task_id: str, operation: str) -> dict:
        task_dir = root / task_id
        (task_dir / "outputs").mkdir(parents=True)
        (task_dir / "work").mkdir()
        return {
            "type": "run", "taskId": task_id, "operation": operation, "params": {"k": 1}, "inputs": [],
            "outputDir": str(task_dir / "outputs"), "workDir": str(task_dir / "work"), "models": {}, "variant": "cpu",
        }

    def test_handshake_result_cancel_and_exit_on_disconnect(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            process, reader, writer = self.start(root)
            try:
                ready = self.until(reader, "ready")[-1]
                self.assertEqual(ready["protocol"], 1)
                self.assertEqual(ready["operations"], ["echo", "fail", "wait"])

                self.send(writer, self.run_message(root, "a" * 32, "echo"))
                messages = self.until(reader, "result")
                self.assertEqual(messages[0]["type"], "progress")
                self.assertEqual(messages[-1]["outputs"], [{"name": "echo", "fileName": "echo.txt", "mimeType": "text/plain"}])

                self.send(writer, self.run_message(root, "b" * 32, "fail"))
                failed = self.until(reader, "error")[-1]
                self.assertEqual(failed["code"], "fixture-failure")

                self.send(writer, self.run_message(root, "c" * 32, "wait"))
                self.until(reader, "progress")
                self.send(writer, {"type": "cancel", "taskId": "c" * 32})
                self.assertEqual(self.until(reader, "cancelled")[-1]["taskId"], "c" * 32)

                # Host disconnect: the backend exits although its helper lives.
                writer.close()
                started = time.monotonic()
                process.wait(timeout=10)
                self.assertLess(time.monotonic() - started, 10)
                self.assertEqual(reader.read(), b"")
            finally:
                if process.poll() is None:
                    process.kill()
                reader.close()
                pid_file = root / ("c" * 32) / "outputs" / "pid.txt"
                if pid_file.exists():
                    try:
                        import signal

                        os.kill(int(pid_file.read_text()), signal.SIGTERM)
                    except OSError:
                        pass


if __name__ == "__main__":
    unittest.main()
