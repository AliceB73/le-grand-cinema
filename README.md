# Nom du projet : Le Grand Cinéma (Application de réservation de billets de cinéma)

## Convention de nommage des branches Git

Pour garantir une gestion claire du versionning du projet, nous appliquons la stratégie GitFlow simplifiée :

- **`main`** : Branche de production, contenant le code stable et déployé.
- **`develop`** : Branche principale de développement où sont intégrées les nouvelles fonctionnalités validées.
- **`feature/<description-courte>`** : Branche dédiée au développement d'une fonctionnalité ou d'une User Story spécifique (ex: `feature/login-user`, `feature/reservation-seats`).
- **`bugfix/<description-courte>`** : Branche dédiée à la résolution d'un bug (ex: `bugfix/fix-seat-booking`).
- **`hotfix/<description-courte>`** : Branche pour les corrections urgentes à appliquer directement sur la production.

## Démarrage local

### Prérequis

- Git, Node.js 24 et npm 11
- Docker Desktop démarré
- Supabase CLI, fournie comme dépendance du projet (`npm ci`)

### Installer les dépendances et configurer l’environnement

Depuis la racine `le-grand-cinema` :

```powershell
npm ci
Copy-Item .env.example .env
```

La configuration Supabase est versionnée dans `supabase/config.toml`. Pour démarrer les services locaux :

```powershell
npm run supabase:start
npm run supabase:status
```

Copiez la clé `anon` affichée par `supabase status` dans `.env` à la place de `SUPABASE_ANON_KEY`. Les variables `.env` ne doivent jamais être commitées.

Prisma est configuré pour la base locale et son schéma est validé. Aucune table métier ni migration initiale n’est inventée pendant l’amorçage ; la première migration sera créée avec le premier modèle métier défini.

Depuis la racine du projet, après avoir démarré Supabase, créez une migration Prisma en lui donnant un nom :

```powershell
npm run prisma:migrate -- --name init_cinema_domain
```

### Démarrer les applications dans Docker

```powershell
npm run dev
```

- Interface React : <http://localhost:5173>
- API : <http://localhost:3000/api/health>
- Swagger UI : <http://localhost:3000/api/docs>
- Supabase Studio : <http://localhost:54323>

Docker Compose démarre le front et l’API. Supabase CLI démarre séparément ses services dans Docker ; l’API les joint via `host.docker.internal`.

Pour arrêter les conteneurs applicatifs et Supabase :

```powershell
docker compose down
npm run supabase:stop
```

### Vérifications

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run prisma:validate
npm run build
npm run test:e2e
```

Les tests bout en bout Playwright lancent le serveur front automatiquement ; l’API doit être en cours d’exécution pour que le lien Swagger soit utilisable. Le workflow GitHub Actions requiert les secrets `SONAR_TOKEN`, `SONAR_ORGANIZATION` et `SONAR_PROJECT_KEY` pour analyser le projet dans SonarCloud.
