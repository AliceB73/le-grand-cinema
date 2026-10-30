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
- Un projet Supabase cloud (URL, clés `anon` et `service_role`, chaînes de connexion Postgres)
- Supabase CLI, fournie comme dépendance du projet (`npm.cmd ci`), uniquement utile pour un Supabase local hors Docker Compose

### Installer les dépendances et configurer l’environnement

Depuis la racine `le-grand-cinema` :

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

La configuration Supabase locale est versionnée dans `supabase/config.toml` et n’est plus utilisée par Docker Compose, qui cible le projet cloud. Pour un Supabase local optionnel (hors Compose), démarrez les services avec :

```powershell
npm.cmd run supabase:start
npm.cmd run supabase:status
```

Copiez la clé `anon` affichée par `supabase status` dans `.env` à la place de `SUPABASE_ANON_KEY` et de `VITE_SUPABASE_ANON_KEY`. Copiez également la clé `service_role` dans `SUPABASE_SERVICE_ROLE_KEY` : elle reste côté API pour l’effacement de compte Auth Admin et le seed, jamais dans une variable `VITE_`. Les variables `.env` ne doivent jamais être commitées. Après une modification de `supabase/config.toml` (longueur minimale du mot de passe, URL de redirection), arrêtez puis redémarrez Supabase pour recharger Auth. Les courriels d’authentification locaux (réinitialisation de mot de passe) sont envoyés par Supabase Auth via le SMTP Resend (`[auth.email.smtp]`, port 2587) vers la vraie adresse du spectateur ; `RESEND_API_KEY` et `EMAIL_FROM` (domaine vérifié dans Resend) doivent être présents dans `.env` avant `supabase:start`. Si un antivirus analyse le trafic SMTP (ex. Avast Mail Shield), le port 465 échoue avec `x509: certificate signed by unknown authority` : gardez le port 2587. Les migrations Prisma `sync_auth_users` et `account_data_erasure` synchronisent la table `public.User` avec Auth et détachent les réservations au lieu de les supprimer avec le compte.

La bannière de confidentialité mémorise le choix sur l’appareil ; aucun traceur analytique ou publicitaire facultatif n’est actuellement utilisé. La suppression confirmée depuis **Mes billets** anonymise les coordonnées liées aux réservations conservées avant la suppression de l’identité. Les durées légales de conservation de ces données transactionnelles restent à confirmer par le métier.

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

### Développement local avec le projet Supabase cloud

Pour que l’application locale utilise le projet Supabase cloud, configurez dans `.env` les variables `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` avec les valeurs de ce projet. La clé `anon` peut être utilisée dans les variables `VITE_`; `SUPABASE_SERVICE_ROLE_KEY` doit rester réservée à l’API et ne doit jamais être publiée. Gardez `VITE_API_BASE_URL=http://localhost:3000` pour que le navigateur local appelle l’API lancée sur votre machine.

Le projet cloud étant partagé avec la préproduction, toutes les données et tous les comptes créés depuis le navigateur local seront visibles dans ce projet. Ne lancez pas `db:seed`, `prisma:migrate` (`migrate dev`) ou une réinitialisation contre ce projet partagé sans avoir vérifié la cible et l’effet de la commande. Les migrations distantes devront utiliser `prisma migrate deploy` après validation explicite.

L’API lit `CORS_ORIGINS` comme une liste d’origines HTTP(S) séparées par des virgules, sans chemin. La valeur d’exemple conserve les deux origines locales et autorise `https://aliceb73.github.io` pour le site GitHub Pages.

### Publication web GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml` publie `apps/web` depuis `develop`. Dans **Settings > Pages**, choisissez **GitHub Actions** comme source de publication. Vos réglages Vite et le fichier `apps/web/public/404.html` prennent en charge le sous-chemin du dépôt. La publication est ignorée avec un avertissement tant que les variables de dépôt `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` ne sont pas renseignées. Ce sont des valeurs de configuration du navigateur ; n’y placez jamais de clé secrète ou de `service_role`. L’API doit être hébergée et configurée séparément avant de rendre le site pleinement fonctionnel.

### Démarrer les applications dans Docker

```powershell
npm.cmd run dev
```

- Interface React : <http://localhost:5173>
- Inscription / connexion : <http://localhost:5173/inscription> et <http://localhost:5173/connexion>
- API : <http://localhost:3000/api/health>
- Swagger UI : <http://localhost:3000/api/docs>

Docker Compose démarre uniquement le front et l’API, qui utilisent le projet Supabase cloud configuré dans `.env` (voir « Développement local avec le projet Supabase cloud »). Les variables `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont obligatoires ; Compose refuse de démarrer si l’une manque. Supabase CLI n’est pas nécessaire : Studio se trouve dans le dashboard Supabase.

Les dépendances sont persistées dans des volumes Docker nommés. Après l’ajout ou la modification d’une dépendance, un simple redémarrage ou `docker compose up --build` ne met pas à jour un volume déjà créé. Installez les dépendances du service concerné dans ce volume, puis redémarrez-le ; pour une nouvelle dépendance API :

```powershell
docker compose exec api npm install --workspace=@le-grand-cinema/api
docker compose restart api
```

Pour arrêter les conteneurs applicatifs :

```powershell
docker compose down
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

## Espace administrateur

Apr�s `prisma:migrate` puis `db:seed`, un compte admin de d�mo est cr�� (`admin@legrandcinema.local` / `AdminDemo-2026!`, modifiables via `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`). Le seed requiert `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`. L'espace est accessible sur `/admin`.
