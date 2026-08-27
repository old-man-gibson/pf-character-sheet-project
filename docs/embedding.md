# Embedding the sheet in an existing site

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. The `<character-sheet>` custom element: attributes, events, theming through custom properties, and the audit API._

---

## Embedding in an existing site

```html
<script type="module" src="/app/js/sheet-element.js"></script>

<character-sheet
  src="/characters/your-character.json"
  role="player"
  theme="light"
  storage-key="campaign:your-character"
  snapshot-every="20"></character-sheet>
```

| Attribute | Purpose |
|---|---|
| `src` | URL of a character JSON document |
| `role` | `player` (default) or `admin` — admin reveals the Formula Audit tab |
| `theme` | `dark` (default) or `light` |
| `storage-key` | localStorage key for edits; omit for the per-character default |
| `snapshot-every` | changes between automatic snapshots (default 20) |
| `hotkeys` | `off` stops the sheet claiming <kbd>Ctrl</kbd>+<kbd>K</kbd> from the host page (see below) |

**The one key it listens for on your page.** <kbd>Ctrl</kbd>+<kbd>K</kbd> opens the
sheet's [search palette](using-the-sheet.md#finding-things-the-search-palette), and it is
worth having when focus is anywhere on the page rather than only inside the sheet — so
that one listener sits on the document. It stands down for a host that wants the key:
if you handle the event first and call `preventDefault()` it is yours, if the person is
typing into one of your own fields nothing happens, and `hotkeys="off"` turns it off
outright. Everything else the sheet listens to is inside its own shadow root, `/`
included.

**Properties / methods:** `.character` (get or set a document directly, no fetch),
`.model`, `.toJSON()`, `.audit()`, `.resetToSource()`, `.whenReady()` (resolves once
stored state has been reconciled — setting `.character` starts an IndexedDB read, so the
model is not there on the next line), `.changeCount`.

**Events:** `character-change` (`detail: {character, diff}`) and `tracker-change`
(`detail: {tracker}`), both composed so they cross the shadow boundary.

A host page that saves server-side can ignore all of the local machinery and listen to
`character-change`. One that wants the saved-version and history behaviour gets it for
free; see [Saving, and going back](importing-and-saving.md#saving-and-going-back) for what is stored where.

The component renders into a shadow root, so host CSS and sheet CSS cannot collide
in either direction. Theming is done with custom properties, which do pierce the
boundary:

```css
character-sheet { --cs-accent: #7b3f9d; --cs-radius: 14px; }
```

Available: `--cs-bg`, `--cs-panel`, `--cs-panel-2`, `--cs-line`, `--cs-text`,
`--cs-muted`, `--cs-accent`, `--cs-good`, `--cs-bad`, `--cs-edit`, `--cs-radius`,
`--cs-font`, `--cs-mono`, and `--cs-formula` / `--cs-formula-strong` (the edge that
marks a field as accepting formulas, at rest and on hover).

The six ability hues are properties too — `--ab-str`, `--ab-dex`, `--ab-con`,
`--ab-int`, `--ab-wis`, `--ab-cha` — with `--ab-wash`, `--ab-edge` and `--ab-ink`
saying how much of a hue the background, the border and the word each take. See
*[Ability colours](using-the-sheet.md#ability-colours)*.

Two more are geometry rather than colour, and a host page that scrolls is likely to
want both:

`--cs-sticky-top` is where the tab rail — the tab bar, and in the session view the
strip of hit points, AC and saves — comes to rest when the sheet is scrolled. It
defaults to `0px`, against the top of the window. A host with a fixed header of its
own should set this to that header's height, or the rail pins behind it:

```css
character-sheet { --cs-sticky-top: 56px; }
```

`--cs-table-max` is how tall a table may get before it scrolls inside its own box
instead of running the page down; that inner scroll is also what holds its column
headings in place. It defaults to `calc(100svh - var(--cs-sticky-top) - 10rem)`,
which reads the *window* — so a sheet embedded in a short container of the host's
wants its own value, and `none` turns the behaviour off entirely.

There is no build step and no runtime dependency — plain ES modules.

One thing to keep together: the component fetches its stylesheet, `app/css/sheet.css`,
at load time, resolved relative to `app/js/styles.js` rather than to the host page. So
`app/css/` has to be served alongside `app/js/` — copying the `js` folder somewhere on
its own leaves the sheet unstyled. If the sheet is served from another origin, that
origin needs CORS headers on the `.css` as well as on the modules, and a host page with
a `Content-Security-Policy` needs that origin in `connect-src` (for the fetch) and
`style-src` (for the fallback `<link>`, which is used only when the fetch fails).

The stylesheet is parsed once per page and adopted by every `<character-sheet>` on it,
so a page with several sheets pays for the CSS once.
