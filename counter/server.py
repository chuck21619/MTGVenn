"""Visitor counter for the MTGVenn site. It runs as a web service on Render.

The count lives in a secret gist, because Render's free services lose their
files. Set GITHUB_TOKEN to a token that can read and write gists.

    GET  /count  returns the current count
    POST /visit  adds one visit and returns the new count
"""

import json
import os
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Browsers send "null" as the origin for a page opened directly from a file.
LIVE_ORIGIN = "https://chuck21619.github.io"
ALLOWED_ORIGINS = {LIVE_ORIGIN, "http://localhost:8000", "null"}
GIST_URL = "https://api.github.com/gists/ddd7f0854c1d620f561f1c0f683ab0dc"
GIST_FILE = "visitor-count.txt"

# Only one visit at a time can read, add to and save the count.
count_lock = threading.Lock()


def github_request(method="GET", body=None):
    request = urllib.request.Request(
        GIST_URL,
        method=method,
        data=json.dumps(body).encode() if body else None,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
            "User-Agent": "MTGVenn-counter",
        },
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def read_count():
    gist = github_request()
    return int(gist["files"][GIST_FILE]["content"])


def write_count(count):
    github_request("PATCH", {"files": {GIST_FILE: {"content": str(count)}}})


def add_visit():
    with count_lock:
        count = read_count() + 1
        write_count(count)
        return count


class CounterHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/count":
            self.respond_with_count(read_count)
        elif self.path == "/":
            self.respond(200, {"status": "ok"})
        else:
            self.respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/visit":
            self.respond(404, {"error": "not found"})
        elif self.headers.get("Origin") not in ALLOWED_ORIGINS:
            self.respond(403, {"error": "forbidden"})
        else:
            self.respond_with_count(add_visit)

    def respond_with_count(self, get_count):
        try:
            self.respond(200, {"count": get_count()})
        except Exception as error:
            print(f"Count failed: {error}")
            self.respond(502, {"error": "count unavailable"})

    def respond(self, status, body):
        data = json.dumps(body).encode()

        origin = self.headers.get("Origin")

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header(
            "Access-Control-Allow-Origin",
            origin if origin in ALLOWED_ORIGINS else LIVE_ORIGIN,
        )
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(data)


class CounterServer(ThreadingHTTPServer):
    # Lets a burst of visitors wait in line instead of being turned away.
    request_queue_size = 128


def main():
    port = int(os.environ.get("PORT", "10000"))
    CounterServer(("0.0.0.0", port), CounterHandler).serve_forever()


if __name__ == "__main__":
    main()
