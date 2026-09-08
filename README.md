# Rituel

Application d'entraînement installable (PWA) avec coach IA. Programme du jour, saisie des séries, chrono de repos automatique, suivi de progression, analyse de chaque séance et ajustement des charges par Claude.

## Architecture

- `public/` — l'application (HTML/CSS/JS, sans build). Servie par Firebase Hosting, installable sur iOS/Android, fonctionne hors ligne (service worker).
- Firebase **Authentication** (Google) — un compte par utilisateur.
- **Firestore** — `users/{uid}/logs`, `bw`, `tests`, `coach`, `overrides`. Persistance hors ligne native : les séries saisies sans réseau partent seules au retour de la connexion. Règles : chaque utilisateur ne lit et n'écrit que son sous-arbre.
- **Cloud Functions** (`functions/index.js`, région europe-west1) — `coach` : reçoit une demande authentifiée, lit le journal de l'utilisateur, appelle l'API Anthropic avec la clé stockée en secret, renvoie et enregistre l'analyse. La clé ne quitte jamais le serveur.

## Déploiement

```
firebase use rituel-6b365
cd functions && npm install && cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY     # colle la clé quand elle est demandée
firebase deploy
```

Le plan Blaze est requis pour la fonction (appel sortant vers Anthropic). Modèle : `COACH_MODEL=auto` choisit le Sonnet le plus récent du compte ; un identifiant précis peut être fixé via le paramètre `COACH_MODEL` (`firebase functions:config` ou `.env` dans `functions/`).

URL après déploiement : https://rituel-6b365.web.app

## Mettre à jour le programme

`public/program.json` (prescriptions, semaines, échauffement) et `public/cycle.html` (lecture du cycle). Copier aussi `program.json` dans `functions/` pour que le coach connaisse les exercices. Incrémenter `VERSION` dans `public/sw.js`, puis `firebase deploy --only hosting,functions`.
