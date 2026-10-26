import asyncio
import importlib.util
import tempfile
import unittest
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "tinybuild" / "python" / "server.py"
spec = importlib.util.spec_from_file_location("tinybuild_python", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PythonExampleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="tinybuild-python-test-")
        self.root = Path(self.directory.name)
        (self.root / "index.html").write_text("<h1>Example</h1>")
        (self.root / ".env").write_text("private")
        (self.root / "signing.key").write_text("private")
        self.app = module.create_app(self.root, interval=0)
        self.client = self.app.test_client()

    async def asyncTearDown(self):
        self.directory.cleanup()

    async def test_static_errors_and_private_files(self):
        self.assertEqual((await self.client.get("/")).status_code, 200)
        self.assertEqual((await self.client.get("/missing")).status_code, 404)
        self.assertEqual((await self.client.get("/.env")).status_code, 403)
        self.assertEqual((await self.client.get("/signing.key")).status_code, 403)
        self.assertEqual((await self.client.get("/../outside")).status_code, 403)

    async def test_socket_echo_and_cleanup(self):
        async with self.client.websocket("/") as socket:
            await socket.send("hello")
            self.assertEqual(await asyncio.wait_for(socket.receive(), 1), "hello")
        self.assertEqual(len(self.app.socket_queues), 0)

    async def test_sse_format_and_disconnect_cleanup(self):
        async with self.client.request("/sse", method="GET", headers={"Origin": "http://localhost:8080"}) as connection:
            self.assertEqual(await asyncio.wait_for(connection.receive(), 1), b": connected\n\n")
            await self.app.broadcast("first\nsecond")
            self.assertEqual(await asyncio.wait_for(connection.receive(), 1), b"data: first\ndata: second\n\n")
            await connection.disconnect()
        self.assertEqual(len(self.app.sse_queues), 0)

    async def test_queues_are_bounded_and_latest_is_json(self):
        queue = asyncio.Queue(maxsize=2)
        self.app.socket_queues.add(queue)
        for value in range(5):
            await self.app.broadcast(value)
        self.assertEqual(queue.qsize(), 2)
        self.assertEqual((await (await self.client.get("/latest")).get_json())["value"], 4)

    async def test_background_ticker_starts_and_shuts_down(self):
        app = module.create_app(self.root, interval=0.01)
        async with app.test_app():
            await asyncio.sleep(0.04)
            response = await app.test_client().get("/latest")
            self.assertGreater((await response.get_json())["value"], 0)
        self.assertFalse(any("ticks" in task.get_coro().__qualname__ for task in asyncio.all_tasks() if task is not asyncio.current_task()))


if __name__ == "__main__":
    unittest.main()
