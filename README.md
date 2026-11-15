# Ringfall.io

A top-down 2D battle royale in the style of surviv.io. Drop in with 24 bots, loot guns, gear and heals from houses, bunkers, banks and airdrops, and be the last one standing as the red zone closes in.

**Play:** https://br672i-blip.github.io/ringfall/ (the game itself is at [/play/](https://br672i-blip.github.io/ringfall/play/))

## Controls

| Action | Keys |
|---|---|
| Move | WASD |
| Aim / shoot | Mouse |
| Pick up | F or E |
| Reload | R |
| Weapons | 1, 2, 3 (fists), 4 or G (throwables) |
| Heal | 7 bandage, 8 med kit, 9 soda, 0 pills |

Touch controls work on phones and tablets.

## Online play with friends

The GitHub Pages version is single-player. To play together, run the server on your own computer:

```sh
npm install
npm start
```

Then open http://localhost:8080, pick **Solo**, **Duo** or **Squad** (optionally **Blitz**) and press **Play Online**. Friends on the same network can join at the "Same network" address the server prints.

To play with specific friends, one of you presses **Create Team** and shares the 4-letter code or the **Copy link** link; the others press **Join Team** and type the code, or open the link. Everyone with the same code plays on one team, in the mode the code's creator picked, and strangers never fill your team's empty spots (bots do).

Each match uses the mode most connected players picked. In Duo and Squad, human players are put on the same teams first and bots fill the remaining spots; anyone who joins in the first 40 seconds takes a bot's place on a team that already has a human. `/status` shows the current mode.

## Files

- `index.html`: the whole game (rendering, simulation, bots, single-player and online client).
- `server.js`: HTTP + WebSocket server. It loads the game script from `index.html` into a sandbox so matches run with the same rules.
- `server-sim.js`: turns the single-player simulation into a shared match (joins, inputs, snapshots).
- `site/`: the landing page for GitHub Pages. The deploy workflow puts it at the site root and the game at `/play/`.
