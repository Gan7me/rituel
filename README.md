# Rituel

Application d'entraînement installable (PWA) : programme du jour, saisie des séries, chrono de repos automatique, suivi de progression. Fonctionne entièrement hors ligne. Synchronisation optionnelle vers un dépôt GitHub privé.

Aucune dépendance, aucun build : HTML, CSS, JS statiques.

## Déploiement (10 minutes)

1. Créer un dépôt **public** `rituel` sur GitHub et y pousser ce dossier.
2. Settings → Pages → Source : *Deploy from a branch*, branche `main`, dossier `/ (root)`. Attendre l'URL `https://<compte>.github.io/rituel/`.
3. Créer un second dépôt **privé** `rituel-data`, vide, avec un fichier README (pour que la branche `main` existe).
4. Créer un token : Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → Repository access : *Only select repositories* → `rituel-data` → Permissions → Contents : *Read and write*. Expiration au choix (renouveler ensuite dans l'app).
5. Sur le téléphone, ouvrir l'URL de l'app, l'ajouter à l'écran d'accueil (iOS : Partager → Sur l'écran d'accueil ; Android : Installer l'application).
6. Dans l'app, onglet ⚙ : renseigner compte, dépôt de données, token → *Tester* → *Enregistrer*.

Le journal (`data/journal.json`) est alors poussé dans `rituel-data` à chaque changement (20 s après la dernière saisie), au retour du réseau, et à chaque « Séance terminée ». La puce en haut à droite indique l'état et lance une synchro manuelle.

## Fonctionnement

- Données stockées localement (`localStorage`), l'app ne dépend jamais du réseau pendant une séance.
- Fusion locale/GitHub document par document sur `updatedAt` : le plus récent gagne, rien n'est écrasé.
- Plusieurs appareils peuvent partager le même dépôt de données.
- Export / import JSON depuis ⚙ pour sauvegarde ou transmission sans GitHub.
- Écran maintenu allumé pendant une séance (Wake Lock, si supporté). Bip, vibration et notification à la fin du repos.

## Mettre à jour le programme

`program.json` contient les séances (généré depuis le programme mensuel), `cycle.html` la lecture du cycle. Remplacer les deux fichiers, incrémenter `VERSION` dans `sw.js`, pousser. Les journaux existants restent compatibles (identifiants d'exercices `session-numéro`).

## Structure

```
index.html          shell de l'application
app.js              logique (séance, chrono, suivi, synchro GitHub, réglages)
styles.css
program.json        prescriptions par séance et par semaine
cycle.html          documentation du mésocycle
sw.js               service worker (cache hors ligne)
manifest.webmanifest
icons/
```
