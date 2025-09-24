DumbGame - Local 2-player browser fighter

Open `index.html` in a browser (or use a simple static server) to play.

Controls:
- Player 1: A/D to move, W to jump, F attack, G special
- Player 2: ←/→ to move, ↑ to jump, K attack, L special

Match rules: 3 stocks per player. Fall off screen to lose a stock.

Features included in this prototype:
- Two local players sharing one keyboard
- Procedural pixel-style characters with idle/walk/jump/attack visuals
- Stage with ground and floating platforms (jump-through)
- Ledge grabbing: approach a platform edge while falling and press Up to climb
- Basic attacks and specials (fireball for P1, dash for P2)
- Knockback and damage scaling
- Stocks (3 lives) and HUD showing damage
- Simple chiptune music loop and retro SFX (WebAudio)

Audio controls are in the top HUD: toggle music and adjust volume.

To run locally:

Python 3 built-in server:

```bash
python3 -m http.server
```

Then open http://localhost:8000 in a desktop browser. Click Start Match to begin (this also enables audio in most browsers).

Notes and next steps:
- This is intentionally minimal and designed to be a starting point. I can add sprite sheets, proper animations, character select, AI opponent, or polish audio if you want.

