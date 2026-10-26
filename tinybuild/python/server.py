"""Optional Quart app: static files, WebSockets and SSE with bounded client queues."""
import asyncio
import contextlib
import os
from pathlib import Path

from quart import Quart, abort, jsonify, make_response, request, send_from_directory, websocket


def create_app(root=None, startpage=None, interval=2.0):
    public = Path(root or os.environ.get("TINYBUILD_ROOT", ".")).resolve()
    entry = startpage or os.environ.get("TINYBUILD_STARTPAGE", "index.html")
    app = Quart(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024
    sockets = set()
    streams = set()
    latest = {"value": 0}
    ticker = None

    async def broadcast(value):
        latest["value"] = value
        for queue in list(sockets | streams):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(str(value))

    app.broadcast = broadcast
    app.socket_queues = sockets
    app.sse_queues = streams

    async def ticks():
        count = 0
        while True:
            await asyncio.sleep(interval)
            count += 1
            await broadcast(count)

    @app.before_serving
    async def startup():
        nonlocal ticker
        if interval:
            ticker = asyncio.create_task(ticks())

    @app.after_serving
    async def shutdown():
        if ticker:
            ticker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await ticker

    async def static_file(filename):
        target = (public / filename).resolve()
        if not target.is_relative_to(public) or target.suffix.lower() in {".pem", ".key", ".pfx", ".jks"} or any(part.startswith(".") or part == "node_modules" for part in Path(filename).parts):
            abort(403)
        return await send_from_directory(public, filename)

    @app.get("/")
    async def index():
        return await static_file(entry)

    @app.get("/latest")
    async def current():
        return jsonify(latest)

    @app.get("/<path:filename>")
    async def resource(filename):
        return await static_file(filename)

    @app.websocket("/")
    async def socket():
        queue = asyncio.Queue(maxsize=32)
        sockets.add(queue)

        async def transmit():
            while True:
                await websocket.send(await queue.get())

        async def receive():
            while True:
                message = await websocket.receive()
                if message != "nodejs":
                    await broadcast(message)

        outgoing = asyncio.create_task(transmit())
        incoming = asyncio.create_task(receive())
        try:
            await asyncio.wait([outgoing, incoming], return_when=asyncio.FIRST_COMPLETED)
        finally:
            sockets.discard(queue)
            for task in (outgoing, incoming):
                task.cancel()
            await asyncio.gather(outgoing, incoming, return_exceptions=True)

    @app.get("/sse")
    async def events():
        queue = asyncio.Queue(maxsize=32)

        async def generate():
            streams.add(queue)
            try:
                yield b": connected\n\n"
                while True:
                    value = await queue.get()
                    yield ("".join("data: " + line + "\n" for line in value.splitlines()) + "\n").encode()
            finally:
                streams.discard(queue)

        headers = {"Content-Type": "text/event-stream", "Cache-Control": "no-cache"}
        allowed = os.environ.get("TINYBUILD_CORS_ORIGIN", "http://localhost:8080")
        if request.headers.get("Origin") == allowed:
            headers["Access-Control-Allow-Origin"] = allowed
            headers["Vary"] = "Origin"
        response = await make_response(generate(), headers)
        response.timeout = None
        return response

    @app.errorhandler(404)
    async def missing(error):
        return "Not found", 404

    return app


app = create_app()

if __name__ == "__main__":
    # Hypercorn owns graceful shutdown in both HTTP and optional TLS deployments.
    from hypercorn.asyncio import serve
    from hypercorn.config import Config
    config = Config()
    config.bind = [os.environ.get("TINYBUILD_HOST", "127.0.0.1") + ":" + os.environ.get("TINYBUILD_PYTHON_PORT", "7000")]
    config.certfile = os.environ.get("TINYBUILD_CERT")
    config.keyfile = os.environ.get("TINYBUILD_KEY")
    asyncio.run(serve(app, config))
