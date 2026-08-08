# CONTEXT.md — la-pause

Glossary of domain terms for the French word-ladder game **la-pause**. The purpose is to give canonical names to concepts so that architecture reviews and deepening work use the same vocabulary, and to flag the concepts that name good seams.

## The game

Player starts from a 5-letter French word and must reach **PAUSE**, changing exactly **one letter per move**. Every move must be a word from the lexicon (accents are stripped and ignored). Each word has a **par** — the length of the shortest path to PAUSE.

| Term | Canonical meaning | Notes / seams |
| --- | --- | --- |
| **échelle de mots** | the game genre; the ladder of words from start to PAUSE | the core loop |
| **PAUSE** | the target word every game must reach | fixed across the whole game |
| **coup** (pl. coups) | one move — a valid word one letter away from the previous word | the legality rule |
| **par** | distance (in coups) from a word to PAUSE; also the puzzle's difficulty rating | derived from the lexicon graph; five call sites today — a good seam |
| **mot de départ** | the starting word of a game | daily seeded by date; free mode random |
| **mode quotidien** | the daily puzzle — one per calendar day, seeded deterministically from the date | tied to the daily boundary |
| **mode illimité** | the free-play mode — a new random start on demand | free hint per game lives here |
| **conseil** (hint) | two kinds: *position* (which letter to change) and *mot suivant* (play the next word automatically) | hint computation is a candidate deep module |
| **jeton** (token, 🪙) | currency earned by solving with no hints; spent on hints (position = 1, mot suivant = 2) | the hint economy — rules currently scattered |
| **série** (streak) | consecutive daily wins, reset when a day is missed | staleness logic split across client and server today — a known seam |
| **étoiles** (stars) | rating on solve: 3 stars if no hints, 2 if one hint, 1 otherwise | triplicated today — a good seam |
| **classement** (leaderboard) | two boards: *quotidien* (fewest coups then hints per day) and *illimité* (most free-mode wins) | |
| **frontière du jour** (daily boundary) | America/Toronto midnight — the instant the daily puzzle, streak, analytics, and leaderboard day roll over | implemented twice (Node and browser) today |
| **analytique quotidienne** | the per-day metrics row: visiteurs invités, joueurs connectés, victoires quotidiennes, victoires illimitées | reads exist in three places today — a good seam |

## Analytics counters

| Term | Meaning |
| --- | --- |
| **visiteur invité** (guest visit) | a unique anonymous visitor on a given day |
| **joueur connecté** (registered visit) | a unique authenticated user active on a given day |
| **victoire quotidienne** | a solved daily puzzle |
| **victoire illimitée** | a solved free-mode game |

## Player progress

| Term | Meaning |
| --- | --- |
| **progression du joueur** | the synced player record: jetons, victoires, série, meilleure série | merge policy (`Math.max`) is a candidate deep module |
| **victoires illimitées** (free-mode wins) | device-local counter pushed to the illimité leaderboard; not part of the sync payload today | a third "two owners" seam |

## Architecture vocabulary

Reviews use the `/codebase-design` terms: **module**, **interface**, **depth**, **deep**, **shallow**, **seam**, **adapter**, **leverage**, **locality**. Principles: the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real".

## Deepening work

Tracked in GitHub issues from the architecture review (candidate 1): the **ladder-rules module** is being deepened incrementally, starting with move validation (a native ES module, lexicon injected at construction, characterization-tested via `npm test`). Remaining increments along the same seam: par/stars/share-text, hint computation, win/undo state machine, and the hint economy.
