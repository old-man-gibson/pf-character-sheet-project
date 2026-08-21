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
  [Customized weapons](sub-systems.md#spheres--magic-training) to put them in — but the
  converter still leaves them in *From the source tab* to be retyped. Reading that shape
  across in `convert.py` / `convert.js` would close the loop. It is one workbook's layout,
  so it wants the fixture to hand.
- **Class-side sub-ability granularity.** An archetype that replaces a *sub-ability*
  (Ronin's *Honorless Tactics* for Resolve's *Determined*) marks the parent as altered and
  sits beside it; it does not edit inside the parent's text. Fine to read, coarse to model.
