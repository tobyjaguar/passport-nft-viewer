#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 talgya
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Tiny receiver for test/e2e.html?report=… — saves the first POST body to a file
# and exits. Usage: python3 e2e-receiver.py <port> <out.json>
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, out = int(sys.argv[1]), sys.argv[2]

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        open(out, 'wb').write(body)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.server.done = True
    def log_message(self, *a):
        pass

srv = HTTPServer(('127.0.0.1', port), H)
srv.done = False
while not srv.done:
    srv.handle_request()
print(f'saved {out}')
