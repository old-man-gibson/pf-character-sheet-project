# GM Module

Tooling for solo Pathfinder sessions with Claude as GM. The engine repo ships
content-free, so everything with game or campaign content in it
(`campaigns/`, `rules/`) is git-ignored; the tooling here is content-free.

## Layout

```
tools.json          the GM tools registry: which folders are tools
tools/roll.mjs      crypto-backed dice roller (see header comment for usage)
lib/gm-tools.mjs    the GM tools mount for tools/serve.mjs: loads manifests and APIs
lib/http.mjs        HTTP helpers for the GM servers
screen/             session screen: server.mjs + board page
planner/            session planner: the GM page and the player view (plan.js is the
                    model, timeline.js the markup both pages draw, stores.js where
                    plans are kept, api.mjs the file API)
plans/              (git-ignored) the planner's plan files, one JSON file per session
rules/              (git-ignored) homebrew docs and rules references, grep-able
campaigns/
  _template/        copy to start a new campaign
  <name>/
    campaign.md     GM-only: premise, real situation, arcs   [SPOILERS]
    npcs/           one file per NPC + _index.md             [SPOILERS]
    rulings.md      adjudications & house rules, kept consistent
    calendar.md     in-game date, wealth, downtime, deadlines
    party/          character sheet exports (JSON) from the sheet app
    state/          live session state: session.md + board.json
    log/            player-facing session recaps (spoiler-free)
```

## Session screen

```
node gm-module/screen/server.mjs 8765 --board gm-module/campaigns/<name>/state/board.json
```

Without `--board` it serves the sandbox board. The page is the *player view*: the server strips hidden
tokens, `gmNote` fields, and the `gm` block before anything reaches the
browser. The GM edits `board.json` directly; the page polls and re-renders.
The player drags tokens; moves write back into the same file.

`board.json` shape: `map` (name/w/h), `terrain` (wall cells `{x,y,t:"wall"}`),
`fog` (`enabled` + `revealed` rects `[x,y,w,h]`), `initiative`
(`round`/`active`/`order` of token ids), `tokens`
(`id/name/faction/x/y/size/hp:[cur,max]`, optional `hidden`, `gmNote`,
`color`). Factions: `pc`, `ally`, `enemy`, `neutral`.

## GM tools menu

The sheet's top bar has a **GM tools** button listing the tools here; each
opens in a tab of its own and keeps its saved files apart from the characters.

- **On this computer** (`node tools/serve.mjs`) every registered tool is
  listed, server parts and all. Everything under `/gm-module/` (the menu, the
  pages, the APIs, the saved files) answers this computer only, so players on
  the same network see nothing of it. Saved files go in a folder of each tool's
  own under the GM data folder: `gm-module/` by default (git-ignored folders such
  as `plans/`), or another with `node tools/serve.mjs --gm-data <folder>`.
- **On the public site** the tools marked `"site": true` are listed. The deploy
  ships `tools.json` and those tools' folders only (see `.assetsignore`), never
  `campaigns/`, `rules/` or plan files. Such a tool keeps what it saves in the
  visitor's browser.

A tool is a folder named in `tools.json` (`{ "folders": [...] }`) with a
`gm-tool.json` in it:

```json
{
  "tools": [{ "id": "planner", "name": "Session planner",
              "description": "One line for the menu", "page": "index.html" }],
  "api": "api.mjs",
  "data": "plans",
  "site": true
}
```

Each entry in `tools` is a menu line opening `page` (a path inside the folder);
a folder may list several. `api` and `data` are for a tool with a server part:
`api` is a module whose default export takes `{ dir }` (the `data` folder under
the GM data folder) and returns a handler `(req, res, route, url)` for requests
to `/gm-module/<folder>/api/<route>`; pages ask for it by the relative address
`api/<route>`. The mount has already checked that the request is from this
computer and that a write is JSON. `site` says the tool also works with no
server part. A tool whose manifest or server part fails to load is left out of
the menu and named in the server's startup output; the tests check `tools.json`
names every folder with a manifest. `planner/` is the worked example
(`gm-tool.json`, `api.mjs`, and `stores.js` for working with or without its API).

## Session planner

Open it from the sheet's GM tools button. It plans a session as a timeline with
one lane per player:

- Activities run in parallel, but a player is in one activity at a time. A
  move, resize or edit that would put a player in two overlapping activities
  is refused, with the activity in the way named. Back-to-back is fine.
- An activity can take at most a set number of players (empty: no limit). A
  full activity offers no more places: adding a player, or lowering the limit
  below who is in it, is refused. Its blocks show how full it is (2/3).
- An activity with several players has a block in each of their lanes; moving
  one moves them all. Dragging a block onto another player's lane hands that
  player's place to the other player. Dragging its right edge changes its
  duration. Times snap to the plan's step (1–30 minutes).
- Activities not on the timeline wait in the Unscheduled tray. Drag one onto a
  lane to place it (the lane's player joins it), or drag a block onto the tray
  to take it off.
- Clicking a block opens it: title, players, start and duration, premise, and
  its checks. Each check is one way to try the activity, with its own DC, reward
  on success, further success tiers (each with its own DC and reward) and what
  happens on failure. **Add another check** starts a new one with the last one's
  DC and outcomes, to change what differs. Outcomes lists the chosen check's
  thresholds and what each brings (failure, success, tiers and their rewards),
  or every check in turn on *All checks* (the page remembers that choice); a
  test box marks which step a check total reaches on each one listed.
- A **hidden check** (*Add a hidden check*, or tick *Hidden check* on one) is a
  specialized way in that the players are not shown: one for a character with
  the right thing in their toolkit. It says what it *needs* ("Alchemist, or
  ranks in Craft (alchemy)", "shapeshifting"), its roll is optional, and any of
  its DCs can be marked *Auto*: reached without a roll by a character who has
  what it needs. Anyone else rolls for it as usual. The test box then has a
  *Has …* tick for trying both. A block counts its hidden checks ("+1
  hidden") and names them in its tooltip.
- The **World** row above the players holds world events: things that happen
  at their time whoever is there (a patrol passes, a bell rings). Double-click
  it to add one, or tick *World event* in an activity. An event has no players,
  so it books nobody, and it is not in the player view; it can have checks, a
  result and links like any activity.
- Double-click a lane to add an activity there. Arrow keys move a focused block
  (Shift changes its duration; up and down move it to the next lane); Delete
  removes it; Ctrl+Z undoes.

**NPCs.** The NPCs button opens the plan's NPC list in the side panel. Each NPC
has a name, a role, a description and notes. Link NPCs to an activity from the
activity's editor (or make a new one there), or from the NPC's own panel, which
lists its activities and outlines them on the timeline. Linking one NPC to two
activities at the same time is allowed, since a link can mean "about them" as
well as "with them", but both panels point it out. Deleting an NPC unlinks it
everywhere; Undo brings it back.

**Notes, links and what happened.** During play, each activity's editor records
*what happened*: done, or one outcome of one of its checks (failure, success or
a tier). The Notes button opens the plan's notes: free text, each about an
activity, about one of its outcomes, or about nothing in particular. Links run
from an activity, one of its outcomes, or a note, to another activity, and
either *lead to* it or *block* it. Add them in the activity editor's Links
section or in a note. A link is in effect once its source has happened: the
activity has a result, that outcome was the result, or the note is ticked or
what it is about was recorded. On the timeline:

- links between activities are lines from the end of one block to the start
  of the other, green for *leads to* and red for *blocks*, dashed until in effect;
- a blocked activity is struck through in red, and one that something leads to
  waits (dimmed, dashed) until one of those links is in effect. Blocking wins;
- an activity with a result shows ✓, and every block's tooltip says why it is
  where it is.

Links from notes have no line, since a note has no place on the timeline; the
activities they reach show it in their state. Deleting an activity, check, tier
or note takes the results, notes and links that named it with it (Undo brings
them back).

**Characters and odds.** The activity editor's Characters section links each
player to a character from the character sheet in this browser (the planner is
served from the same site, so it can read the sheet's characters; it never
writes them). Under each check it then shows each linked player's bonus and
their chance of each step on a d20, read through the sheet's own roll code so
conditions count. Checks are matched by name: skills (Knowledge either way it
is written), saves, initiative, and ability checks by their exact name. A save
fails on a 1 and succeeds on a 20; a trained-only skill with no ranks is
flagged.

For a hidden check it first looks for what the check needs among what the
sheet's search palette lists of the character (classes and archetypes, feats,
spheres and talents, spells, powers, veils, maneuvers, techniques, gear, class
features, companions) and the skills they have ranks in. The needs are read as
alternatives split at commas and "or", each of parts joined by "and"; a part is
met by one thing that has every word of it, words compared by their stem
("alchemist" meets "alchemy"), and "5 ranks" asks for five. The match is
loose, so the line says what it found ("the sheet has Wizard (class)"), and the
Auto steps read "auto" for that player.

**Library.** *Save to library* keeps an activity, with its checks, tiers and
outcomes, for any session; the tray's *Library* button lists them and adds a
copy to the plan. New plan can also *bring over what was not played*: copies of
the open plan's activities without a result, in the new plan's tray.

**Recap and run sheet.** *Recap* gathers what the session came to from the
results: what each activity came to, the rewards earned and by whom, what did
not happen and why, and the notes that happened; *Download .md* or *Copy* it
for the campaign log (notes can be left out). *Run sheet* opens the session in
time order, with every check (hidden ones marked, with what they need), DC,
tier, reward, failure, NPC, link and note, to read at the table or print.

**Player view.** The Player view button opens `players.html#<plan>`: the same
timeline, read-only, for a second screen or a screen share. It shows each
scheduled activity's title, time, duration and players, and the names of its
checks when its Show checks box is ticked ("Stealth or Bluff"). Notes, links,
results and NPCs are not part of it. It only ever gets a plan as `playerView` in
plan.js makes it, from a list of the fields players may see: DCs, rewards,
success tiers, premises, NPCs, hidden checks and unscheduled activities are
left out. It asks
for changes every second, so it follows the GM page's edits about a second
after they are saved.

**Where plans are kept** (`stores.js`; the bar says which):

- *Files*, when the sheet runs on this computer with `node tools/serve.mjs`:
  `<name>.json` in `gm-module/plans/` (git-ignored) or the `--gm-data` folder's
  `plans/`, with the activity library as `_library.json` beside them. A file can be edited while the page is open: the page reloads it
  within a couple of seconds, and never writes over a change it has not seen
  (it loads the newer copy and keeps its own for Undo). A hand edit that books a
  player twice is flagged on the page. The player view's data is built on the
  server, so the browser showing it never receives the GM's fields.
- *This browser*, everywhere else (the public site): the browser's own
  `gm-planner` database, apart from the characters and packs. Another tab
  editing the same plan is handled the same way as a file edit. The player view
  has to be open in the same browser (a second window, or a screen share).

**Export** downloads the open plan as the same `.json` a plan file is, and
**Import** adds one as a new plan (named after the file), so plans move between
the two, or between computers. **Delete plan** asks once more before it
deletes. A new plan starts with the open plan's players and NPCs.

Plan shape: `title`, `startsAt` ("19:00" or ""), `length` and `snap` in minutes,
`players` (`id/name/color/character`), `npcs` (`id/name/role/description/notes`),
`activities` (`id/title/start/duration/event/players/maxPlayers/npcs`, `premise`,
`checks: [{id, check, dc, success, failure, hidden, needs, auto, tiers: [{id, label, dc, auto, reward}]}]`,
`result`: null or `{check, outcome}` with outcome `done`/`failure`/`success`/a tier id),
`notes` (`id/text/about/happened`) and `links` (`id/from/to/kind`, kind `leads` or
`blocks`; `from` and `about` are `{activity}`, `{activity, check, outcome}` or
`{note}`).
`start` is minutes from the start of the session, null when unscheduled. Other
fields are kept as they are. A plan from before several checks, with `check`,
`dc`, `success`, `failure` and `tiers` on the activity, reads as one check.

## Dice

```
node gm-module/tools/roll.mjs --label "Fighter attack" 1d20+9 1d8+5
node gm-module/tools/roll.mjs --secret campaigns/<name>/gm-rolls.log 1d20+12
```

All dice come from `crypto.randomInt`. The GM procedure (a local
Claude Code skill, kept outside the repository) requires quoting roller output verbatim and forbids fudging.

## Spoiler discipline

Files marked [SPOILERS] are meant to be read only by the GM. Perfect secrecy
is impossible (file reads appear in the transcript's tool calls), so the deal
is: the GM never restates secrets in chat, and the player doesn't expand tool
results or open GM files between sessions.
