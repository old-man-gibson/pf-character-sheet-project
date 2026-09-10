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
| `theme` | a palette: `dark` (default), `light`, `workbench`, `workbench-dark`, `parchment`, `slate` or `ink` |
| `width` | how much of its container the sheet takes: `100` (default), `90`, `80` or `70`, centred when less than all of it |
| `layout` | `top` (default) runs the tab bar across the sheet; `side` runs it down the left where there is room (780px of sheet), and falls back to the bar below that. The rail has a `<slot name="rail">` at its top for the host's own furniture — the app page puts its character picker there |
| `storage-key` | localStorage key for edits; omit for the per-character default |
| `snapshot-every` | changes between automatic snapshots (default 20) |
| `hotkeys` | `off` stops the sheet claiming <kbd>Ctrl</kbd>+<kbd>K</kbd> and <kbd>Ctrl</kbd>+<kbd>S</kbd> from the host page (see below) |

**The two keys it listens for on your page.** <kbd>Ctrl</kbd>+<kbd>K</kbd> opens the
sheet's [search palette](using-the-sheet.md#finding-things-the-search-palette), and it is
worth having when focus is anywhere on the page rather than only inside the sheet — so
that one listener sits on the document. It stands down for a host that wants the key:
if you handle the event first and call `preventDefault()` it is yours, if the person is
typing into one of your own fields nothing happens, and `hotkeys="off"` turns it off
outright. <kbd>Ctrl</kbd>+<kbd>S</kbd> saves, and is claimed on a much shorter leash: only
when focus is already inside the sheet and only when there is something to save, so a host
page's own editor keeps the key it expects. Everything else the sheet listens to is inside
its own shadow root, `/` included.

**Properties / methods:** `.character` (get or set a document directly, no fetch),
`.model`, `.toJSON()`, `.audit()`, `.resetToSource()`, `.whenReady()` (resolves once
stored state has been reconciled — setting `.character` starts an IndexedDB read, so the
model is not there on the next line), `.changeCount`.

**Events:** `character-change` (`detail: {character, diff}`) and `tracker-change`
(`detail: {tracker}`), both composed so they cross the shadow boundary.

A host page that saves server-side can ignore all of the local machinery and listen to
`character-change`. One that wants the saved-version and history behaviour gets it for
free; see [Saving, and going back](importing-and-saving.md#saving-and-going-back) for what is stored where.

**Themes and the person's own choice.** The palettes are declared in
`app/css/sheet.css`, one `:host([theme="…"])` block each, and listed in
`app/js/themes.js`. Beside `theme` the element stamps `scheme="light"` or
`scheme="dark"` on itself, which is what the few rules that care about lightness rather
than hue key on; a host does not set it. The sheet's **⋯ → Theme & layout** picker lets
the person choose a palette and a layout, and that choice is remembered in the browser
(`localStorage`, under `character-sheet:theme`) and applied when the element connects —
*over* the attributes, since the attributes are the page's choice for everyone and the
preference is this person's. A host that must look one way can keep the picker out of
reach; one that wants to follow the sheet listens for `theme-change` (composed, with
`detail: {palette, theme, scheme, layout, width}`) and can read the sheet's computed custom
properties — `getComputedStyle(sheet).getPropertyValue('--cs-bg')` and the rest work from
outside the shadow root — which is how `app/index.html` colours its own chrome without a
second copy of any palette.

Two of the palettes (Workbench and Parchment) are set in web faces — Alegreya, Alegreya SC,
IBM Plex Sans and IBM Plex Mono. The element does not load fonts; `app/index.html` carries
the same Google Fonts link the Workbench page does, and a host that does not gets Georgia
and the system face in their place.

The component renders into a shadow root, so host CSS and sheet CSS cannot collide
in either direction. Theming is done with custom properties, which do pierce the
boundary:

```css
character-sheet { --cs-accent: #7b3f9d; --cs-radius: 14px; }
```

Available: `--cs-bg`, `--cs-panel`, `--cs-panel-2`, `--cs-line`, `--cs-text`,
`--cs-muted`, `--cs-accent`, `--cs-good`, `--cs-bad`, `--cs-edit`, `--cs-radius`,
`--cs-font`, `--cs-mono`, `--cs-display` (the face the character's name and the panel
headings take; the body face unless a palette says otherwise), and `--cs-formula` /
`--cs-formula-strong` (the edge that marks a field as accepting formulas, at rest and on
hover).

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

`--cs-tablebg` is what a scroll box paints its edges against. A table that can scroll
sideways carries a shadow at whichever end has something past it, and the trick that
draws it needs to know the colour behind the box; it defaults to `--cs-panel`, which is
what every table on the sheet sits on. Set it on any wrapper you put a table into that
is a different colour, or the shadow leaves a band.

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
