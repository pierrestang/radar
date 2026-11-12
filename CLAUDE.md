# Radar — notes pour Claude

Voir README.md pour l'architecture. Points non évidents :
- **Données réelles** dans le Gist secret de l'utilisateur (trouvé par sa description `Radar — données (ne pas supprimer)`). Pour tester, utiliser des données factices injectées dans localStorage (`radar.*`), jamais écrire dans le vrai Gist sans accord.
- Dépôt **public** : ne jamais committer d'ID de Gist, de jeton ni d'événement. Les logs Actions sont publics → `sync.mjs` ne journalise pas les titres.
- Code partagé navigateur/Node dans `shared/` (ESM sans dépendance, ical.js injecté).
- Après modif de l'app : incrémenter `CACHE` dans `sw.js` pour forcer la mise à jour sur l'iPhone.
- Heures stockées en ISO UTC ; journées entières en `AAAA-MM-JJ` avec fin exclusive. Fuseau par défaut des heures flottantes : Europe/Paris.

## État d'avancement
- 2026-11-12 : v1 — PWA (agenda, sources, abonnement), saisie manuelle, flux .ics, synchro Actions 30 min, 6 tests.
- 2026-11-12 : synchro immédiate — l'app lance `sync.yml` (workflow_dispatch) à l'ajout/changement d'URL d'un agenda et suit l'avancement ; second jeton fine-grained (Actions write sur `radar`) stocké en `radar.syncToken`. Lecture directe depuis le navigateur tentée d'abord (si CORS autorisé).
- 2026-11-12 : francisation des flux (`shared/translate.js`, dictionnaire, appliquée dans `mergedEvents` → app + .ics ; « A VS B », notes, lieux ; option par source `translate`). Pas d'appel à un service de traduction.
- À faire : capture d'écran → événement.
