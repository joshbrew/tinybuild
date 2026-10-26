# Optional Quart server

See the [Python guide](../docs/python.md). create_app(root, startpage, interval) creates an app without process signal handlers.

Standalone: python server.py serves the working directory on 127.0.0.1:7000. For deployment set TINYBUILD_ROOT to public files and optionally set TINYBUILD_CERT/TINYBUILD_KEY.

Bounded client queues and asynchronous tasks are cleaned up on disconnection/shutdown. Replace the demonstration ticker with application producers.
