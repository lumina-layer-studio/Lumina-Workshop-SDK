# lumina-workshop-backend

Python SDK for Lumina Studio Creative Workshop module backends (Workshop API
1.1.0, control protocol v1). Standard library only; Python 3.12.

```python
from lumina_workshop_backend import Backend, TaskContext, TaskFailure

backend = Backend()


@backend.operation("invert-alpha")
def invert_alpha(task: TaskContext) -> None:
    data = task.inputs["image"].read_bytes()
    task.progress(0, 1, "processing")
    task.check_cancelled()  # raises TaskCancelled after a cancel request
    if not data:
        raise TaskFailure("empty-input", "The image is empty.")
    task.write_output("image", "result.png", "image/png", process(data))


if __name__ == "__main__":
    backend.serve()
```

The host starts the backend on demand, sends one task at a time, cancels
cooperatively and then ends the process tree after a grace period, and stops
idle backends. Finished outputs stay in host storage after the backend stops.
The SDK exits as soon as the host closes the control channel.

`lumina_workshop_backend.testing.run_operation()` runs an operation
in-process for module unit tests. See `docs/backend-protocol.md` in the SDK
repository for the launch contract and message reference.
