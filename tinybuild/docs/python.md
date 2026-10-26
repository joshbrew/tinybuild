# Python backend

Install Python 3.11+ and python -m pip install -r tinybuild/python/requirements.txt.

From examples/python_backend, run node ../../tinybuild/bin/global.js mode=python. Missing boilerplate is copied without replacing existing Python files. The child is supervised separately from frontend builds.

The Quart app provides static serving, WebSocket /, SSE /sse, and JSON /latest. Hypercorn serves HTTP or optional TLS. Cancellation cleans up queues and the background ticker.

Standalone environment: TINYBUILD_ROOT, TINYBUILD_STARTPAGE, TINYBUILD_HOST, TINYBUILD_PYTHON_PORT, TINYBUILD_CERT and TINYBUILD_KEY. Cross-origin SSE allows TINYBUILD_CORS_ORIGIN (default http://localhost:8080). Set a public root for deployment.

Run npm run test:python after installing optional dependencies.
