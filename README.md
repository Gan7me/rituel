# Rituel

Application d'entraînement installable (PWA) avec coach IA. Programme du jour, saisie des séries, chrono de repos automatique, suivi de progression, analyse de chaque séance et ajustement des charges par Claude.

## Architecture

- `public/` — l'application (HTML/CSS/JS, sans build). Servie par Firebase Hosting, installable sur iOS/Android, fonctionne hors ligne (service worker).
- Firebase **Authentication** (Google) — un compte par utilisateur.
- **Firestore** — `users/{uid}/meta/profile` (profil saisi à la première connexion), `users/{uid}/meta/program` (programme généré par le coach ou importé), `users/{uid}/logs`, `bw`, `tests`, `coach`, `overrides`. Persistance hors ligne native : les séries saisies sans réseau partent seules au retour de la connexion. Règles : chaque utilisateur ne lit et n'écrit que son sous-arbre.
- **Cloud Functions** (`functions/index.js`, région europe-west1) — `coach`, trois modes : `program` (génère un mésocycle de 4 semaines à partir du profil et du matériel), `analyse` (analyse une séance terminée, propose des ajustements), `chat` (question libre avec le journal en contexte). Appelle l'API Anthropic avec la clé stockée en secret ; la clé ne quitte jamais le serveur. Sans compte, l'application n'affiche que l'écran de connexion.

## Déploiement

```
firebase use rituel-6b365
cd functions && npm install && cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY     # colle la clé quand elle est demandée
firebase deploy
```

Le plan Blaze est requis pour la fonction (appel sortant vers Anthropic). Modèle : `COACH_MODEL=auto` choisit le Sonnet le plus récent du compte ; un identifiant précis peut être fixé via le paramètre `COACH_MODEL` (`firebase functions:config` ou `.env` dans `functions/`).

URL après déploiement : https://rituel-6b365.web.app

## Programme par défaut

`public/program.json` et `public/cycle.html` sont le programme « Fondations » proposé à l'import lors de l'onboarding (athlète confirmé, ON AIR Lyon). Chaque utilisateur peut à la place générer son propre cycle avec le coach, puis en regénérer un depuis l'onglet Programme. Incrémenter `VERSION` dans `public/sw.js` à chaque déploiement.

## Applications natives (Capacitor + Codemagic)

`capacitor.config.json` enveloppe l'app web dans une coquille native (`fr.rituel.app`) qui charge `https://rituel-6b365.web.app` : une seule base de code, mises à jour instantanées côté web, accès aux notifications push et à la connexion Apple native. Les dossiers `ios/` et `android/` sont générés à la volée par le pipeline (`npx cap add …`), ils ne sont pas versionnés.

`codemagic.yaml` décrit deux workflows : iOS vers TestFlight (signature via l'intégration App Store Connect) et Android vers un `.aab`. Pré-requis côté Codemagic : connecter le dépôt Git, créer l'intégration App Store Connect nommée `rituel_asc`, ajouter un keystore Android nommé `rituel_keystore`, renseigner la variable `APP_STORE_APPLE_ID`.

Alternative Android immédiate : PWABuilder (pwabuilder.com) sur l'URL de production, puis `.well-known/assetlinks.json` avec l'empreinte SHA-256 fournie.

## Quotas et suppression de compte

La fonction `coach` plafonne par compte et par mois : 4 programmes, 60 analyses, 300 messages (`QUOTAS` dans `functions/index.js`). La fonction `deleteAccount` efface tout le sous-arbre `users/{uid}` puis le compte Auth, depuis Réglages.


## Tests

`node tests/e2e.js` lance l'app dans Chromium sans tête avec un Firebase simulé (aucun réseau, aucun coût) et parcourt les parcours critiques : accueil, création de compte, onboarding en 4 étapes, séance (saisie, validation, chrono, menu, lexique), coach (analyse, bilan, relance, application des charges, chat), suivi, programme, réglages, thème sombre. Dépendances : `npm i -D puppeteer-core` et un Chromium (`CHROME=/chemin/vers/chrome`). À lancer avant chaque `firebase deploy`.

## Fonctions planifiées

- `weeklyReview` : dimanche 19 h (Europe/Paris), bilan de semaine par athlète actif (1 appel IA), relance si aucune séance, proposition de cycle suivant en fin de mésocycle.
- `dailyNudge` : 18 h, relance sans IA après 3 jours sans séance.


## Application native (iOS / Android) — dossier `native/`

Coquille Expo autour de la web app hébergée : WebView plein écran + notification locale de fin de repos (téléphone verrouillé), push du coach (service Expo), haptique, écran maintenu allumé. Se compile et se publie avec EAS comme n'importe quelle app Expo.

```bash
cd native
npm install
eas init                                   # une fois : lie le projet à ton compte Expo (owner + projectId)
eas build --platform ios --profile production
eas submit --platform ios --latest         # → TestFlight
eas build --platform android --profile production
eas submit --platform android --latest     # → Play Console (test interne)
```

L'interface se met à jour via `firebase deploy` sans nouveau build ; un build n'est nécessaire que pour changer la coquille (`native/`).
