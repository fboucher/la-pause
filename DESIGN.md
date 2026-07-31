# La pause — Design document

A French clone of [Poople](https://poople.io) (the word-ladder game), themed around
the coffee break: « votre pause café ». Target word: **PAUSE** (5 letters).

Status: design consolidated (grill-me session). Not yet implemented.

---

## Concept

- **Poople-style word ladder**, not Wordle. Start from a 5-letter word, change
  exactly **one letter per move**, every move must be a valid French word, and
  reach **PAUSE** in as few steps as possible.
- Daily + unlimited (practice) modes.
- Target word is always **PAUSE** (like POOP in Poople).

## Feasibility (validated)

Against an open 4.5 MB French lexicon, accent-normalized:

- 5,891 unique 5-letter words
- **5,131 (87 %) are connected to PAUSE**
- **4,321 start words whose shortest path to PAUSE is 4–8 steps** → daily pool
- PAUSE's one-letter neighbors: `cause, panse, passe, payse, paume, pausa`
- Coffee words connect too: LATTE→5, MOULU→5, SUCRE→7, GRAIN→8, TASSE→2

## Game rules

- Change exactly one letter per move; every move must be in the valid-word list.
- **Undo allowed** (backtrack last move / retry branches).
- **No hints, no reveal**, no step limit. Fewest steps wins (par shown).
- After solving, the daily board **locks until the next puzzle**.

## Daily puzzle

- Resets at **midnight Montreal** (`America/Toronto`, DST-aware).
- Pool = precomputed verified start words (shortest path **4–8**).
- Today's puzzle = date → pool index, so **all players get the same puzzle with
  no backend**. Shares are reproducible.

## Unlimited mode

- Any solvable start word from the full connected set (any path length).

## Word list & validation

- Open French lexicon, **accent-normalized** (é→e), includes verb conjugations
  and inflections, deduped to 5-letter a–z forms.
- Validation: word must be in the list **and** differ from the previous word by
  exactly one letter. Invalid submissions → red shake + message.

## UX & theme

- **100 % French UI**, tagline « votre pause café ».
- **Warm minimal** aesthetic: espresso browns, latte cream, soft steam animation.
- Native keyboard input; ladder renders as a **path list** with each step's
  changed letter highlighted. Mobile responsive.

## Stats & share (localStorage)

- Resumes today's progress on reload.
- Streak (consecutive days won), win rate, step distribution.
- Share copies a no-spoiler line: « La pause n°X — 6 coups (par 5) ».

## Build pipeline

- `tools/` **Node script**: normalize → filter 5-letter → dedupe → build graph →
  BFS to PAUSE → emit `public/data.json` (valid words + daily pool + per-word par).
  Deterministic; regenerate when the source lexicon changes.
- App: **vanilla HTML/CSS/JS** (ES modules), zero dependencies, no build step.

## Container & deployment

- **Prod**: multi-stage Dockerfile → `nginx:alpine`, port 80, healthcheck.
- **Dev**: compose service with volume mount (hot reload).
- `docker-compose.yml` with both services. Runs locally for now.

## Repo structure (proposal)

```
la-pause/
  tools/build.js          # word list → data.json
  public/
    index.html
    style.css
    app.js
    data.json
  Dockerfile
  docker-compose.yml
  README.md
```

## Defaulted decisions (open to change)

- Word-list attribution in the footer.
- DST handled via `America/Toronto` timezone.
- Invalid-word feedback: red shake + message.
- Daily lock: no replay of an already-solved daily puzzle.
