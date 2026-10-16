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
- Supabase CLI, fournie comme dépendance du projet (`npm.cmd ci`)

### Installer les dépendances et configurer l’environnement

Depuis la racine `le-grand-cinema` :

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

La configuration Supabase est versionnée dans `supabase/config.toml`. Pour démarrer les services locaux :

```powershell
npm.cmd run supabase:start
npm.cmd run supabase:status
```

Copiez la clé `anon` affichée par `supabase status` dans `.env` à la place de `SUPABASE_ANON_KEY`. Les variables `.env` ne doivent jamais être commitées.

### Stripe Checkout en mode test

Configurez `STRIPE_SECRET_KEY` avec une clé secrète de test Stripe (`sk_test_…`) et `WEB_BASE_URL=http://localhost:5173` dans `.env`. Sans clé de test, le site reste consultable mais le paiement renvoie une erreur explicite de configuration. Pour recevoir les notifications localement, démarrez Stripe CLI dans un premier terminal PowerShell et laissez-le ouvert :

```powershell
stripe login
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded --forward-to localhost:3000/api/payments/webhook
```

Copiez le secret `whsec_…` affiché par cette commande dans `STRIPE_WEBHOOK_SECRET` de `.env`, puis redémarrez l’API. Pour vérifier le transfert, effectuez un vrai checkout démarré depuis l’application dans un second terminal/navigateur : le terminal Stripe CLI doit afficher `checkout.session.completed` puis une réponse HTTP `200` vers `/api/payments/webhook`. Le message `Trigger succeeded!` de `stripe trigger checkout.session.completed` confirme seulement la création d’un événement synthétique dans Stripe ; il n’est pas lié à la réservation de l’application et ne valide pas le parcours de paiement complet. Les clés Stripe réelles ne doivent jamais être ajoutées à `.env.example` ni commitées. Pour simuler un paiement, utilisez les moyens de paiement de test documentés par Stripe, par exemple la carte `4242 4242 4242 4242`, avec une date future et un CVC de test.

Une réservation invitée est confirmée uniquement par le webhook Stripe signé. Les verrous de sièges restent limités à 10 minutes même lorsque Checkout est ouvert ; un paiement accepté après leur expiration n’attribue pas les sièges et doit être traité comme remboursement.

Prisma pilote le schéma applicatif et ses migrations versionnées dans `apps/api/prisma/migrations`. La migration `add_movie_genre` ajoute un genre principal contrôlé au modèle `Movie`.

Depuis la racine du projet, après avoir démarré Supabase, créez une migration Prisma en lui donnant un nom :

```powershell
npm.cmd run prisma:migrate -- --name init_cinema_domain
```

Après avoir appliqué les migrations, chargez les films et séances fictifs locaux :

```powershell
npm.cmd run db:seed
```

Le seed peut être relancé sans créer de doublons : il crée trois films et 72 séances, à raison de deux séances hebdomadaires par film, du 12 octobre au 31 décembre 2026. Les jours et horaires sont pseudo-aléatoires, réalistes et identiques à chaque relance. Les migrations applicatives sont gérées par Prisma ; après une réinitialisation complète de Supabase, appliquez les migrations déjà versionnées avec `npm run prisma:migrate`, puis relancez le seed. Cette réinitialisation efface les données de la base locale.

### Démarrer les applications dans Docker

```powershell
npm.cmd run dev
```

- Interface React : <http://localhost:5173>
- API : <http://localhost:3000/api/health>
- Swagger UI : <http://localhost:3000/api/docs>
- Supabase Studio : <http://localhost:54323>

Docker Compose démarre le front et l’API. Supabase CLI démarre séparément ses services dans Docker ; l’API les joint via `host.docker.internal`.

Les dépendances sont persistées dans des volumes Docker nommés. Après l’ajout ou la modification d’une dépendance, un simple redémarrage ou `docker compose up --build` ne met pas à jour un volume déjà créé. Installez les dépendances du service concerné dans ce volume, puis redémarrez-le ; pour une nouvelle dépendance API :

```powershell
docker compose exec api npm install --workspace=@le-grand-cinema/api
docker compose restart api
```

Pour arrêter les conteneurs applicatifs et Supabase :

```powershell
docker compose down
npm.cmd run supabase:stop
```

### Vérifications

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test:coverage
npm.cmd run prisma:validate
npm.cmd run build
npm.cmd run test:e2e
```

Les tests bout en bout Playwright lancent le serveur front automatiquement. Le workflow GitHub Actions requiert les secrets `SONAR_TOKEN`, `SONAR_ORGANIZATION` et `SONAR_PROJECT_KEY` pour analyser le projet dans SonarCloud.
