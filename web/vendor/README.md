# Vendored third-party code

| File | Project | Version | License | Source | SHA-256 |
|---|---|---|---|---|---|
| `jsQR.js` | [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 (`jsQR-LICENSE`) | `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js` | `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859` |

jsQR is loaded only when the user opens the QR scanner **and** the browser has no
native `BarcodeDetector` (Chrome on Linux and Windows desktop). It is vendored
rather than fetched from a CDN so the page's Content-Security-Policy can stay at
`script-src 'self'` and the whole thing is auditable from this repository.

Verify: `sha256sum web/vendor/jsQR.js`.
