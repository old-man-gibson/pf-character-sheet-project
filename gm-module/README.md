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
- Clicking a block opens it: title, players, start and duration, premise,
  required check and DC, the reward on success, further success tiers (each
  with its own DC and reward), and what happens on failure. A test box shows
  which tier a check total reaches.
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

**Player view.** The Player view button opens `players.html#<plan>`: the same
timeline, read-only, for a second screen or a screen share. It shows each
scheduled activity's title, time, duration and players, and the required check
when its Show checks box is ticked. It only ever gets a plan as `playerView` in
plan.js makes it, from a list of the fields players may see: DCs, rewards,
success tiers, premises, NPCs and unscheduled activities are left out. It asks
for changes every second, so it follows the GM page's edits about a second
after they are saved.

**Where plans are kept** (`stores.js`; the bar says which):

- *Files*, when the sheet runs on this computer with `node tools/serve.mjs`:
  `<name>.json` in `gm-module/plans/` (git-ignored) or the `--gm-data` folder's
  `plans/`. A file can be edited while the page is open: the page reloads it
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
`players` (`id/name/color`), `npcs` (`id/name/role/description/notes`),
`activities` (`id/title/start/duration/players/maxPlayers/npcs`, `premise`, `check`, `dc`,
`success`, `failure`, `tiers: [{id, label, dc, reward}]`). `start` is minutes
from the start of the session, null when unscheduled. Other fields are kept as
they are.

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
