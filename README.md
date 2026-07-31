# La pause

Un clone francophone de [Poople](https://poople.io), l'échelle de mots, sur le
thème de la pause café. « Votre pause café ». Objectif : rejoindre **PAUSE**.

## Règles

- Partez d'un mot de 5 lettres.
- Changez **exactement une lettre** à chaque coup.
- Chaque mot doit être un mot français valide (liste normalisée sans accents).
- Rejoignez **PAUSE** en le moins de coups possible.
- **Annulation** possible, aucune limite de coups, pas d'indices.

## Modes

- **Quotidienne** : un mot par jour, identique pour tous les joueurs (calculé
  de façon déterministe depuis la date à minuit Montréal, sans serveur). La
  grille se verrouille une fois résolue.
- **Illimitée** : un mot de départ aléatoire, résolvable à volonté.

## Fonctionnement

- **Frontend** : HTML/CSS/JS natif (ES modules), zéro dépendance, aucun build.
- **Dictionnaire** : liste de mots française ouverte
  ([an-array-of-french-words](https://github.com/words/an-array-of-french-words),
  ~336 000 entrées avec conjugaisons et flexions), normalisée sans accents.
  Seuls les mots reliés à PAUSE sont jouables (5 131 sur 5 891 mots de 5 lettres).
- **Pipeline** : `tools/build.js` normalise → filtre les mots de 5 lettres →
  construit le graphe → BFS vers PAUSE → émet `public/data.json`
  (mots valides, par de chaque mot, pool quotidien). Déterministe ; à
  régénérer si le lexique source change.

## Développement

```bash
node tools/build.js        # régénère public/data.json
python3 -m http.server 8080 --directory public   # prévisualisation
```

ou en dev avec hot reload :

```bash
docker compose up dev      # http://localhost:8081
```

## Production

```bash
docker compose up --build  # http://localhost:8080
```

Le Dockerfile multi-étapes régénère `data.json` dans l'image puis sert
`public/` via nginx (port 80, healthcheck).

## Statistiques (localStorage)

Reprise de la partie quotidienne en cours au rechargement, série de victoires
consécutives, taux de réussite et répartition des coups. Partage sans spoiler :
`« La pause n°X — 6 coups (par 5) »`.

## Structure

```
la-pause/
  tools/
    build.js           # liste de mots → data.json
    lexicon.json       # lexique français source (~4,5 Mo)
  public/
    index.html
    style.css
    app.js
    data.json          # généré
  Dockerfile
  docker-compose.yml
  README.md
```
