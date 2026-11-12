# Radar

Web app pour iPhone qui construit **un seul agenda d'événements à venir**, abonnable depuis Google Agenda et le Calendrier de l'iPhone.

App : https://pierrestang.github.io/radar/

## Sources
1. **Lien de calendrier** (.ics / webcal://) : Sync2Cal, Google Agenda public, clubs, billetteries…
2. **Saisie manuelle**
3. **Capture d'écran** : prévue (voir « Évolutions »)

## Fonctionnement
| Élément | Rôle |
|---|---|
| GitHub Pages (ce dépôt) | l'app (PWA statique, sans données) |
| Gist secret « Radar — données » | `config.json` (sources, ajouts manuels, masqués) · `remote.json` (événements des flux) · `radar.ics` (calendrier fusionné publié) |
| Script Google Apps Script (compte Google) | chaque minute : lit `google.json` et met à jour l'agenda Google « Radar » (couleur = rubrique) — code dans `google/Code.gs` |
| GitHub Actions `sync.yml` | lancée par l'app dès qu'un agenda est ajouté (ou modifié), et toutes les ~30 min : relit chaque flux, met à jour `remote.json` et `radar.ics` |

L'app écrit `config.json` et régénère `radar.ics` immédiatement ; la synchro écrit `remote.json` et `radar.ics`. Le lien d'abonnement est l'URL « raw » du Gist (`…/raw/radar.ics`, toujours la dernière version).

## Mise en route
1. Créer un jeton GitHub classique, portée **gist** uniquement : https://github.com/settings/tokens/new?scopes=gist&description=Radar
2. Sur l'iPhone : ouvrir l'app dans Safari › Partager › **Sur l'écran d'accueil**, l'ouvrir depuis l'icône et coller le jeton (le Gist est créé automatiquement).
3. Donner le même jeton à la synchro : `gh secret set GIST_TOKEN -R pierrestang/radar`
4. Synchro immédiate : au premier ajout d'agenda, l'app demande un second jeton *fine-grained* limité au dépôt `radar` avec **Actions : Read and write** (sert uniquement à lancer `sync.yml`).
5. Onglet **Abonnement** › « Ajouter à Google Agenda ».

## Développement
```sh
npm install
npm test                 # tests du moteur iCalendar
npm run serve            # http://127.0.0.1:5180
node scripts/sync.mjs --dry fichier.ics   # tester la lecture d'un flux
```
Pas d'étape de build : `vendor/ical.min.js` est une copie de `node_modules/ical.js/dist/ical.min.js` (2.1.0).

## Évolutions
- **Capture d'écran** : envoyer l'image à un modèle de vision (ex. API Claude) qui renvoie titre/date/lieu, pré-remplir le formulaire de saisie (`origin: 'capture'`).
