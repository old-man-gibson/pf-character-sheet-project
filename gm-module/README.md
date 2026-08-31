# GM Module

Tooling for solo Pathfinder sessions with Claude as GM. The engine repo ships
content-free, so everything with game or campaign content in it
(`campaigns/`, `rules/`) is git-ignored; the tooling here is content-free.

## Layout

```
tools/roll.mjs      crypto-backed dice roller (see header comment for usage)
screen/             session screen: server.mjs + board page
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

or via the `gm-screen` entry in `.claude/launch.json` (serves the sandbox
board by default). The page is the *player view*: the server strips hidden
tokens, `gmNote` fields, and the `gm` block before anything reaches the
browser. The GM edits `board.json` directly; the page polls and re-renders.
The player drags tokens; moves write back into the same file.

`board.json` shape: `map` (name/w/h), `terrain` (wall cells `{x,y,t:"wall"}`),
`fog` (`enabled` + `revealed` rects `[x,y,w,h]`), `initiative`
(`round`/`active`/`order` of token ids), `tokens`
(`id/name/faction/x/y/size/hp:[cur,max]`, optional `hidden`, `gmNote`,
`color`). Factions: `pc`, `ally`, `enemy`, `neutral`.

## Dice

```
node gm-module/tools/roll.mjs --label "Fighter attack" 1d20+9 1d8+5
node gm-module/tools/roll.mjs --secret campaigns/<name>/gm-rolls.log 1d20+12
```

All dice come from `crypto.randomInt`. The GM procedure (`/gm-session` skill)
requires quoting roller output verbatim and forbids fudging.

## Spoiler discipline

Files marked [SPOILERS] are meant to be read only by the GM. Perfect secrecy
is impossible (file reads appear in the transcript's tool calls), so the deal
is: the GM never restates secrets in chat, and the player doesn't expand tool
results or open GM files between sessions.
