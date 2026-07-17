# PDF.js Chromium viewer

This directory is the `content/` output of PDF.js `v6.1.200`'s official
`npx gulp chromium` build. The four JavaScript artifacts are re-emitted by
the same build's Terser `5.46.0` with compression and mangling disabled, with
comments omitted; this removes non-runtime policy-silencing directives without
changing the shipped program. MathRead's `reader.html` hosts its existing
overlay around the upstream viewer DOM.

Source: <https://github.com/mozilla/pdf.js/tree/v6.1.200/extensions/chromium>

The matching upstream extension adapters are vendored in
`extension/mathread/vendor/`. MathRead changes their viewer target from
`content/web/viewer.html` to `reader/reader.html`; all routing, referrer,
history, and keyboard behavior remains upstream PDF.js code.
