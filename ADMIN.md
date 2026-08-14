# Editing the page

All the words and image paths live in one file: **`content.json`**. The page
itself (`index.html`) still ships the real copy as plain HTML — `content.json`
is a patch applied on top of it. If the JSON is missing or broken, the page
falls back to the copy built into the HTML and nothing breaks.

## Open the editor

The editor is a plain web page, but it has to be served over HTTP (a
`file://` page cannot fetch `content.json`).

```bash
cd hiphopdiaperbag
python3 -m http.server 8080
```

Then open <http://127.0.0.1:8080/admin/index.html>.

- Edit any field. Changed fields turn orange.
- **Preview on the page** writes your unsaved edits to `sessionStorage` and
  opens the real landing page in a new tab so you can see them in place.
  Nothing has been saved at this point — close the tab and it's gone.
- Images: **Replace image** picks a file, downscales it to 2000px on the long
  edge and re-encodes it as WebP at quality 0.82, in the browser. The resulting
  size is shown; anything over 500 KB is flagged in orange — pick a smaller
  source rather than shipping it.
- Formatting: in body copy you may use `<em>`, `<b>` and `<br>`. Nothing else
  is treated as markup — a stray `<script>` shows up as literal text on the
  page, by design. In the small uppercase lines, a `/` becomes the grey
  divider.

## Publishing — way 1: export (no account, no token)

1. Hit **Export**.
2. Put the downloaded `content.json` in the project root, replacing the old one.
3. If you changed any images, they download too — put them in `assets/img/`,
   overwriting the files of the same name. The editor lists exactly which
   filenames it expects.
4. Commit and push:

```bash
git add content.json assets/img
git commit -m "Update page content"
git push
```

GitHub Pages rebuilds on its own, usually within a minute.

## Publishing — way 2: straight from the browser (optional)

The **Publish** panel commits `content.json` and any changed images to
`marcusg999/hiphopdiaperbag` on `main` using the GitHub Contents API. It needs
a token. It is entirely optional — way 1 does the same job with no token.

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Repository access: **only** `marcusg999/hiphopdiaperbag`.
   Permissions: **Contents → Read and write**. Nothing else.
3. Give it the shortest expiry you can live with.
4. Paste it into the Publish panel and hit **Publish to main**. The log reports
   each file, the commit sha, or GitHub's own error message verbatim.

### About the token

- It is stored in this browser's `localStorage`, on this machine only.
- It is never written into `content.json`, never committed, and never sent
  anywhere except `api.github.com`.
- Anyone with access to this browser profile can read it. On a shared or public
  machine, hit **Forget token** when you're done — or just use Export instead.
- If a token ever leaks, revoke it on GitHub; it can only touch this one repo's
  contents.

## For developers

- `src/content.js` exports `applyContent()`. It resolves dotted paths
  (`hero.headline.line1`) and writes them into the DOM either through
  `data-content="…"` attributes on the markup, or — for the current markup,
  which has none — through the `BINDINGS` selector table at the top of that
  file. **If you restructure `index.html`, update that table** (or add
  `data-content` attributes, which always win).
- Values are written with `textContent` / `setAttribute`. `innerHTML` is never
  used; the `<em>`/`<b>`/`<br>` allowlist is tokenised and rebuilt as real nodes.
- `src/main.js` calls `await applyContent()` before it wires the reveal
  observers, so text never changes under a finished animation. If that call is
  ever removed, the page still renders correctly — it just stops following
  `content.json`, and Preview stops working.
- Preview reads `sessionStorage['vitrine:preview']`; unsaved images are handed
  over as `blob:` URLs, valid only while the admin tab stays open.
- Sanity check after editing the markup: load the page, run
  `(await import('./src/content.js')).applyContent({preview:false})` in the
  console and confirm the visible copy does not change. If something moves,
  `content.json` and the markup have drifted apart.
