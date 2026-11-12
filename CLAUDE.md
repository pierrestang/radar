# Radar — notes pour Claude

Voir README.md pour l'architecture. Points non évidents :
- **Direction artistique = celle de Fantôme** (~/Fantome/app/static/style.css) : fond animé `fond.js` (copie de Fantôme), feuille crème translucide, Newsreader en serif (`polices/`, licence OFL), tailles 13/15/22/32, espacements 4/8/16/32, arrondis 10/8, boutons noirs, un seul thème clair. Champs à 16 px (anti-zoom iPhone).
- **Données réelles** dans le Gist secret de l'utilisateur (trouvé par sa description `Radar — données (ne pas supprimer)`). Pour tester, utiliser des données factices injectées dans localStorage (`radar.*`), jamais écrire dans le vrai Gist sans accord.
- Dépôt **public** : ne jamais committer d'ID de Gist, de jeton ni d'événement. Les logs Actions sont publics → `sync.mjs` ne journalise pas les titres.
- Code partagé navigateur/Node dans `shared/` (ESM sans dépendance, ical.js injecté).
- Après modif de l'app : incrémenter `CACHE` dans `sw.js` pour forcer la mise à jour sur l'iPhone.
- Heures stockées en ISO UTC ; journées entières en `AAAA-MM-JJ` avec fin exclusive. Fuseau par défaut des heures flottantes : Europe/Paris.

## État d'avancement
- 2026-11-12 : v1 — PWA (agenda, sources, abonnement), saisie manuelle, flux .ics, synchro Actions 30 min, 6 tests.
- 2026-11-12 : synchro immédiate — l'app lance `sync.yml` (workflow_dispatch) à l'ajout/changement d'URL d'un agenda et suit l'avancement ; second jeton fine-grained (Actions write sur `radar`) stocké en `radar.syncToken`. Lecture directe depuis le navigateur tentée d'abord (si CORS autorisé).
- 2026-11-12 : francisation des flux (`shared/translate.js`, dictionnaire, appliquée dans `mergedEvents` → app + .ics ; « A VS B », notes, lieux ; option par source `translate`). Pas d'appel à un service de traduction.
- 2026-11-12 : rubriques (Sport, Jeux vidéo, Film, Série, Vidéo + perso) — `config.categories`, rubrique par défaut d'une source (`source.category`), exception par événement (`config.eventCategories[icsUid]`), `manual[].category`. La source n'est plus affichée dans l'agenda ni dans le .ics (CATEGORIES = rubrique).
- 2026-11-12 : encart « Prochain » aux couleurs de la rubrique + illustration (`ART` dans app.js : ballon, manette, clap, télé, lecture, musique, billet, étoile, radar par défaut) ; `category.icon` choisi dans la fiche rubrique, sinon `DEFAULT_ART[id]`.
- 2026-11-12 : **Google Agenda en écriture directe** — script Apps Script « Radar → Google Agenda » dans le compte Google de l'utilisateur (source : `google/Code.gs`, la constante SOURCE est remplacée à l'installation et jamais commitée). Déclencheur chaque minute : lit `google.json` du Gist (API GitHub, sinon lien raw avec cache 5 min) et crée/modifie/supprime dans l'agenda « Radar » (tags `radarUid`/`radarHash`, couleur Google la plus proche de la rubrique via `googleColorId`). `google.json` est écrit par l'app (chaque modification) et par `sync.mjs`. L'ancien abonnement .ics dans Google a été retiré. Pas de point d'accès public (refusé par la sécurité).
- Pour modifier le script : éditer `google/Code.gs`, puis le recoller dans l'éditeur Apps Script (attention : le presse-papiers peut être écrasé par l'utilisateur entre copie et collage).
- 2026-11-12 : **sources enrichies** — suggestions vérifiées en 1 appui (`SUGGESTIONS` dans app.js : matchcalendar.football, fixtur.es pour les Bleues, smartcalendars.ai pour séries/films) ; **chaînes TV des matchs** via footao.tv (`shared/tv.js`, lu par la synchro toutes les 6 h, cache `remote.tv`, rattachement heure ±20 min + équipe) ; **plateforme des séries** extraite de « Airs on … » ; **artistes suivis** (`config.artists`, source virtuelle `itunes`, API iTunes sans clé, rubrique `config.musicCategory`). Affichage « où le voir » : `ev.tv` / `ev.platform` (cartes, lignes, fiche, .ics et Google via `fullNotes`).
- Pistes non faites : YouTube (flux Atom des chaînes), films FR + plateformes via TMDB (clé gratuite à créer par l'utilisateur, attribution TMDB/JustWatch obligatoire).
- À faire : capture d'écran → événement.
