# A web page with Python streams

From this folder, install the Python requirements and launch both servers:

```sh
python -m pip install -r ../../tinybuild/python/requirements.txt
npm run python
```

Follow the printed frontend URL (normally port 8080). The Python server uses `http://127.0.0.1:7000`. Click the WebSocket and SSE buttons to try the streams; the Python URL also serves the page for same-origin use.

| Edit                                                 | What happens                    |
| ---------------------------------------------------- | ------------------------------- |
| `src/app.js` or its imported components              | Rebuild the frontend            |
| `python/server.py`, copied when this workflow starts | Restart only the Python backend |

Ctrl+C closes both servers. `npm run build` builds the frontend without launching Python. The Python tests cover static/private-file handling, socket echo, SSE framing, cleanup and bounded queues.
