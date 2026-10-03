# Nom du projet : Le Grand Cinéma (Application de réservation de billets de cinéma)

## Convention de nommage des branches Git

Pour garantir une gestion claire du versionning du projet, nous appliquons la stratégie GitFlow simplifiée :

- **`main`** : Branche de production, contenant le code stable et déployé.
- **`develop`** : Branche principale de développement où sont intégrées les nouvelles fonctionnalités validées.
- **`feature/<description-courte>`** : Branche dédiée au développement d'une fonctionnalité ou d'une User Story spécifique (ex: `feature/login-user`, `feature/reservation-seats`).
- **`bugfix/<description-courte>`** : Branche dédiée à la résolution d'un bug (ex: `bugfix/fix-seat-booking`).
- **`hotfix/<description-courte>`** : Branche pour les corrections urgentes à appliquer directement sur la production.