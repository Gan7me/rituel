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
