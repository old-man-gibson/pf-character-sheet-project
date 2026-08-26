# To do

_Part of the [Pathfinder Character Sheet Program](../README.md) docs. Things agreed but not built yet, with enough context to pick each one up cold._

- **A picker for option menus.** Archetype (and, later, class) features can carry a menu of
  options — talents, techniques, arts — which lands as a Template group *Class — Feature*
  (see [Extensions](extensions.md)). The sheet has no way to *choose* from it: the picks are
  still typed into the Progression column's cells by hand, as rogue talents are today. Build
  a dropdown on those cells fed by the matching group (options that name a minimum level
  greyed until it is reached), so a pick is chosen rather than typed and its text is a click
  away. Same control would serve a class page's own menus once the wiki's technique-list
  pages are read.
- **Menu pages of their own.** A class page points at "See: Legendary Samurai Iaijutsu
  Technique" — a separate wiki page listing the options. Reading such a page (title +
  entries) into a feature's `options` on an existing class block would complete the loop.
- **Still hard-coded in the engine** (from the extension-store work): the sphere name lists
  in `rules.js` (they drive skill-rank and unarmed logic), the Primordia techniques, and the
  mythic path names. To be lifted into packs so the engine ships fully content-free.
- **Read a workbook's customization block into its track.** Bryva's Item Crafting tab
  carries her two customized weapons as cells (`M2:S9`: a *Weapon* row, then talent/sphere
  pairs down two columns), and the model now has
  [Customized weapons](sub-systems.md#martial-and-magic-spheres-training) to put them in — but the
  converter still leaves them in *From the source tab* to be retyped. Reading that shape
  across in `convert.py` / `convert.js` would close the loop. It is one workbook's layout,
  so it wants the fixture to hand.
- **Class-side sub-ability granularity.** An archetype that replaces a *sub-ability*
  (Ronin's *Honorless Tactics* for Resolve's *Determined*) marks the parent as altered and
  sits beside it; it does not edit inside the parent's text. Fine to read, coarse to model.
- **Improve the print view.** Ctrl-P prints the tab you are looking at, on white, with the
  chrome hidden — see [Using the sheet](using-the-sheet.md#printing-a-tab). That much
  works, but it has only ever been checked *structurally*: every rule parsed, every
  selector matched a real element, and the buttons were audited across every panel. **No
  page has ever been put through a print preview**, which is the first thing to do, and
  probably the thing that finds most of what is below.
  - **Trackers print with no meter.** Pips are `<button>` when interactive
    (`tag = interactive ? 'button' : 'span'`, `ui/panels/trackers.js`) and the print block
    hides every button except the two it names back, so hit points, essence, power points
    and every resource tracker come out as a name and a number with nothing beside them.
    Restoring `button.pip` alongside `button.mname` and `button.chip-toggle` is most of the
    fix; the fills also want `print-color-adjust: exact`, which today only `table`, `.panel`
    and `.bigstat` carry, or a spent pip and an unspent one print identically.
  - **The palette flip is only half done.** `@media print` redefines the `--cs-*`
    properties, but the ability hues (`--ab-wash`, `--ab-edge`, `--ab-ink`) and the formula
    colours (`--fx-*`) have light values only under `:host([theme="light"])`, and printing
    does not set that attribute. A sheet printed from the dark theme puts the dark versions
    of both onto white paper.
  - **Nothing scales a wide table.** `.tablewrap` gets `overflow: visible` so a scroll
    container cannot clip what it was holding — but a table wider than the page then simply
    runs off it, which is worse than a scrollbar was. The Progression grid and a full
    Equipment table are both wider than portrait A4. Wants a landscape `@page` for those
    tabs, or a scale factor.
  - **There is no `@page` rule at all**, so margins and orientation are whatever the
    browser defaults to.
  - **The portrait prints at screen size**, which is a lot of ink for a decoration.

  Worth deciding at the same time whether *the tab you are looking at* stays the rule. It
  is a rule you can hold in your head while choosing what to hand someone, but a player who
  wants a sheet for the table prints four or five tabs one at a time to get one.
