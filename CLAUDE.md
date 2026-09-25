# Anime Ability Arena

Browser multiplayer Roblox-style PvP ability arena: Three.js client, Colyseus server, npm workspaces
(`shared` / `server` / `client`). Infrastructure (Bloxity auth, persistence, Bux grants, deploy, scripts) follows
`D:\+1 Cut Grass Adventure` (itself from Spider / Superhero Evolution) - NOT Katana Evolution. Gameplay, world and UI
are this game's own.

## Commands

```bash
npm run dev                 # builds shared, then server (tsx watch, :2601) + Vite client (:5201)
npm run build               # shared + server + client (client/dist)
npm run typecheck           # all workspaces
npm run verify              # verify:combat (all 30 abilities, rules, arena walkability, in-process) + verify:assets
npm run verify:multiplayer  # needs a running server: the whole loop, spawn -> portal -> fight -> kill -> respawn -> buy/equip
npm run verify:capacity     # needs a running server on :2601; expects 15-per-room routing
npm run verify:persistence  # identity/storage/migration/purchases/outages, JSON and Mongo (if mongod is found)
npm run size:client         # client/dist size against the 12 MB budget (currently ~5.5 MB)
npm run bot                 # a sparring bot in the arena (MODE=fight COUNT=3 X= Z= to vary)
```

Do NOT use python from the Bash tool on this machine. Use node/sed/perl. Heredocs containing backticks break the
shell wrapper: write edit scripts with the Write tool and run them with node. Never commit or push.
`preview_stop` can leave the tsx server child alive on :2601 - check the port before editing `server/data`.

## Non-negotiable rules

- Ports: server **2601**, Vite **5201**, preview 4201. Room `animeabilityarena`, Bloxity slug `anime-ability-arena`
  (`shared/src/config/accounts.ts` AND `client/src/bloxity/Bloxity.ts`), 15 per room.
- **The player's Bloxity avatar is never replaced.** A kit only hands the body weapons (`client/src/player/Weapons.ts`)
  and a moveset. Kits: `shared/src/config/kits.ts` (15, Asta default ... Saitama 70,000¥, prices from the spec).
- **No `@view` / StateView.** Private data travels as messages.
- **Server-authoritative combat** (`server/src/combat/CombatService.ts`): the client sends INPUT only - move, jump,
  dash and an `act` slot (1 attack, 2 E, 3 R) with an aim yaw on a Move message. `tryCast` checks alive / not stunned /
  not rooted / cooldown by the SERVER clock, then resolves every hit against server positions. `applyHit` is the ONE
  place damage, launch (`applyKnockback`), ragdoll stun, Yen (1 per damage, 40 + streak per kill, `Wallet`) and kills
  happen. Nobody can be hurt on the spawn island (zone 'lobby'). Falls below `KILL_Y` within 8 s of a hit are the
  hitter's kill. Death: 3 s ragdoll, then back to the island, where an arena-chosen kit (`pendingKit`) is equipped.
- **Motion is simulated, never trusted**: `shared/src/sim/PlayerSim.ts` carries jump, dash, stun (ragdoll: input
  ignored), lock (casting root), lunges, leaps (slam on landing), blinks, all as plain numbers replicated in
  `PlayerState` so the client's reconciliation replays a server knockback identically. An ability's `motion` script is
  applied at the SAME input on both sides (`applyMotionScript`). Server-driven moves (Killua's targeted blink,
  Tanjiro's homing lunges) are not predicted.
- **Every hit launches and ragdolls** (spec): M1 stun ~0.75 s, abilities 1-1.9 s. Casts with a wind-up are interrupted
  by a stun (cancelable timers). Devil Union = knockback/stun immunity. Spawn shield 2.5 s (ends on attacking).
- **Client build under 12 MB.** Only `assets/` ships as files (base_rig.fbx, Pets/trophy/rebirth/Sound.png pruned by
  `client/vite.config.ts`). Portraits (`client/src/ui/KitPortraits.ts`), textures, weapons, VFX are code.
  Asset names must be URL-safe (Bloxity Hosting 400s on spaces): the supplied music is `assets/audio/music.mp3`.
- **Responsive HUD**: one unit `--u` (`hudStyles.ts`); arena HUD CSS in `client/src/ui/arenaStyles.ts`. Touch mode
  moves health + tiles to the top left and puts diamond ATTACK/JUMP/DASH/E/R buttons bottom right.
- Adding/changing an ability: data in `kits.ts` (server effect + motion), recipe in `client/src/combat/CastFx.ts`
  (by `vfx`), clip in `client/src/animation/ActionClips.ts`, and a range in `scripts/verify-combat.mjs`.

## Layout facts (`shared/src/config/map.ts`)

- Spawn island: spawn (0,0,2) faces +Z down the walkway; the white portal is BEHIND it at z=-26 (trigger = step in);
  Most Kills board -X, Most Damage +X of it; equipped-kit pedestal at (31,-13). Walkway pedestals: right side (-X)
  Yuji 10K nearest ... Ichigo 250 furthest, left side (+X) Deku 12K ... Saitama 70K (the reference's order).
- Arena: centre (0,-440), a 280x280 field plus lobes (4x the first version). Levels: the ground (0); the central
  ziggurat, tiers 4 / 8 / 12, flights N-S, then E-W, then N-S; four corner forts (`ARENA_FORTS`, platform 10 high,
  field flight on the outer side of the inner face) each with an 18-high keep (flight toward the outer edge); a bridge
  ring at height 10 (`RING_HEIGHT`) joining the forts on pillars; a column ring (`ARENA_COLUMNS`), arches on the
  diagonals, low cover walls (projectiles fly at chest height, so walls block them). Six rim spawns at 118 out.
  `verify:combat` walks every level on foot; the multiplayer test and bots travel along the open rim (124 out).
- No implicit ground: `WorldCollision.floorBelow` returns `NO_FLOOR` over open air.

## Progress and identity

Per-key storage (`server/src/persistence/`), Mongo via `MONGODB_URI` else JSON (`ARENA_DATA_DIR`), profile read at join,
Bloxity token verified server-side, guest -> account migration. There is NO in-game store (removed at the user's
request); the server still accepts Bloxity Bux grant webhooks (`yen_small` 2,500¥, `yen_large` 25,000¥), unused. Profile: `yen, lifetimeYen, kills, deaths, damage, bestStreak, ownedKits, kit, playSeconds`.
Boards rank lifetime kills and damage.

## Testing in the in-app browser

rAF is throttled while tools run. In dev, `window.__t` (`client/src/debug/harness.ts`): `__t.pause()` stops the loop,
`__t.step(n)` advances frames, `__t.try('gojo', 3, 16)` equips a kit, walks to the nearest arena fighter and casts.
Run `npm run bot` for a target. Equipping needs owned kits: seed `server/data/profiles.json` with the server stopped.
