#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import os
import re
import shutil
import socketserver
from http.server import SimpleHTTPRequestHandler


class RangeRequestHandler(SimpleHTTPRequestHandler):
    range_request: tuple[int, int] | None = None

    def send_head(self):
        self.range_request = None
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            for index in ("index.html", "index.htm"):
                index_path = os.path.join(path, index)
                if os.path.exists(index_path):
                    path = index_path
                    break
            else:
                return self.list_directory(path)

        ctype = self.guess_type(path)
        try:
            file = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(file.fileno()).st_size
        start, end = self.parse_range(size)
        if start is not None and end is not None:
            file.seek(start)
            self.range_request = (start, end)
            self.send_response(206)
            self.send_header("Content-type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Last-Modified", self.date_time_string(os.fstat(file.fileno()).st_mtime))
            self.end_headers()
            return file

        self.send_response(200)
        self.send_header("Content-type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(size))
        self.send_header("Last-Modified", self.date_time_string(os.fstat(file.fileno()).st_mtime))
        self.end_headers()
        return file

    def parse_range(self, size: int) -> tuple[int | None, int | None]:
        header = self.headers.get("Range")
        if not header:
            return None, None
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
        if not match:
            return None, None

        start_text, end_text = match.groups()
        if start_text == "" and end_text == "":
            return None, None
        if start_text == "":
            length = int(end_text)
            if length <= 0:
                return None, None
            return max(size - length, 0), size - 1

        start = int(start_text)
        end = int(end_text) if end_text else size - 1
        if start >= size or end < start:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None, None
        return start, min(end, size - 1)

    def copyfile(self, source, outputfile):
        if self.range_request is None:
            return super().copyfile(source, outputfile)
        start, end = self.range_request
        shutil.copyfileobj(_LimitedReader(source, end - start + 1), outputfile)


class _LimitedReader:
    def __init__(self, file, remaining: int):
        self.file = file
        self.remaining = remaining

    def read(self, size: int = -1):
        if self.remaining <= 0:
            return b""
        if size < 0 or size > self.remaining:
            size = self.remaining
        chunk = self.file.read(size)
        self.remaining -= len(chunk)
        return chunk


class ThreadingHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--directory", default="public")
    args = parser.parse_args()

    handler = functools.partial(RangeRequestHandler, directory=args.directory)
    with ThreadingHTTPServer(("", args.port), handler) as httpd:
        print(f"Serving {os.path.abspath(args.directory)} at http://localhost:{args.port}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
