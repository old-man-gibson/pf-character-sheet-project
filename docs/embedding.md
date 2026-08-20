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

There is no build step and no runtime dependency — plain ES modules.
