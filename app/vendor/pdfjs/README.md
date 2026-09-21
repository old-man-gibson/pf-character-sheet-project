# pdf.js

`pdf.min.mjs` and `pdf.worker.min.mjs` from **pdfjs-dist 4.10.38** (Mozilla,
Apache-2.0 — see `LICENSE`), copied unmodified out of the npm package's
`build/` folder.

The one vendored dependency in this app. It is here rather than on a CDN so
that reading a PDF works offline and fetches nothing from anybody, and it is
loaded by `app/js/pdf-import.js` only when somebody actually chooses a PDF in
the extension manager — a player who never does never downloads it.

To update: `npm pack pdfjs-dist@<version>`, copy the same two files and the
licence over these, and change the version above.
