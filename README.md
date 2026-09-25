# Anime Ability Arena

A browser multiplayer Roblox-style PvP arena. You play as your own Bloxity avatar and fight with anime-inspired
ability kits: every hit launches its target into a ragdoll, and knocking someone off the island counts as a kill.

- **Spawn island**: walk down the walkway of kit pedestals (prices in Yen), check the Most Kills / Most Damage boards,
  then step into the white portal (or press **PLAY!**) to enter the arena.
- **The arena**: a huge ruined island over the sea with a stepped ziggurat, four fortresses with keeps and a ring of
  bridges - every height reached by stairs. Fight freely; fall off the island and you die.
- **Controls**: WASD + mouse, Space jump, Click attack (3-hit combo), Q dash, E skill, R ultimate, F unlock/equip at a
  pedestal, I inventory, O settings. On phones: stick + ATTACK / JUMP / DASH / E / R buttons.
- **Yen**: 1¥ per point of damage dealt, 40¥ per kill (+10¥ per kill in your streak). Spend it on kits.
- **15 kits**, each with a unique skill (E) and ultimate (R): Asta (default), Ichigo 250¥, Luffy 500¥, Naruto 1,250¥,
  Jin-Woo 2,500¥, Maki 4,500¥, Sasuke 7,500¥, Yuji Itadori 10,000¥, Deku 12,000¥, Killua 15,000¥, Zoro 18,000¥,
  Tanjiro 26,000¥, Sukuna 37,000¥, Gojo 55,000¥, Saitama 70,000¥. Bought in the arena, a kit equips on your next respawn.

Everything that matters - hits, damage, kills, Yen, unlocks - is decided by the server and saved to your account.

## Development

```bash
npm install
npm run dev        # client http://localhost:5201, server :2601
npm run bot        # a sparring partner in the arena
```

See `CLAUDE.md` for the rules and the verification suites.

## Deployment

Pushing `dev` or `main` runs `.github/workflows/deploy.yml`, in order:

1. **verify** - typecheck, the combat/asset suites, the client build with this channel's backend URL baked in,
   the 12 MB budget, and the client zip (`index.html` at the archive root).
2. **server** - the Docker image (`Dockerfile`, built from the repo root) pushed to
   `ghcr.io/<owner>/anime-ability-arena-server:<channel>-<sha>` and rolled on Legion
   (`POST https://legion.bloxity.io/v1/apps/anime-ability-arena/deploy`, seatCap 15, maxReplicas 5,
   version = the commit SHA).
3. **frontend** - the zip uploaded to `POST https://api.bloxity.io/v1/hosting/games/anime-ability-arena/frontend`
   (version = the same commit SHA), only after the server rolled.

| Channel | Branch | Client | Backend (WebSocket) | Health |
|---|---|---|---|---|
| DEV | `dev` | https://anime-ability-arena.dev.play.bloxity.io | `wss://anime-ability-arena.dev.host.bloxity.io` | https://anime-ability-arena.dev.host.bloxity.io/health |
| PROD | `main` | https://anime-ability-arena.play.bloxity.io | `wss://anime-ability-arena.host.bloxity.io` | https://anime-ability-arena.host.bloxity.io/health |

One secret: `LEGION_DEPLOY_TOKEN` (Settings → Secrets and variables → Actions), copied from My Games on
hosting.bloxity.io. The image is pushed with the built-in `GITHUB_TOKEN`. After the FIRST push, make the GHCR package
`anime-ability-arena-server` public (GitHub → Packages → Package settings → Change visibility) so Legion can pull it,
then re-run the workflow.

Check the Docker build context without Docker: `npm run verify:docker` (`STAGE_DIR=<dir>` also copies the context out).
