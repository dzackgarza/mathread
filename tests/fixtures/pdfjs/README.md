# PDF.js reader fixtures

The binary fixtures in this directory come from Mozilla's Apache-2.0 licensed `mozilla/pdf.js` test corpus at commit lineage `master`:

- `annotation-link-text-popup.pdf`: external HTTP URI annotation.

- `bitmap-symbol-textcomposite.pdf`: JBig2 text-region rendering.

- `copy_paste_ligatures.pdf`: Unicode ligature normalization.

- `extract_link.pdf`: internal link annotation from page 1 to page 2.

- `hello_world_rotated.pdf`: five pages with intrinsic 90-degree rotation.

`cross-span-search.tex` is the editable source for the local cross-text-item search fixture.
Its adjacent TeX boxes force separate PDF text operations while preserving the visible query `theorem 4.2`.
