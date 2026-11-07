# Tests k6 locaux — étapes 1 et 3

Le mode par défaut (étape 1) effectue uniquement des GET vers `/api/health` et
`/api/programme`, et facultativement vers le plan de salle. Il ne crée ni verrou,
ni réservation, ni checkout et n'appelle pas Stripe.

Le mode d'écriture (étape 3) est séparé et désactivé par défaut. Quand il est
explicitement activé, il ne réalise qu'une seule itération : vérifie qu'un siège
de test précis est disponible, le verrouille, vérifie le verrou, le libère puis
vérifie sa disponibilité. Il ne fait ni checkout ni paiement. Cela ne démontre
pas les objectifs de charge du protocole.

Prérequis : k6 déjà installé et API locale déjà disponible. Ne démarrez aucun
service pour ce test sans autorisation. Vérifiez aussi les dépendances de l'API :
une API locale peut utiliser une base Supabase distante ou partagée ; ne la
sollicitez pas sans autorisation. Pour le mode d'écriture, vérifiez que la séance
et le siège sont dédiés aux tests, ne sont pas destinés à la vente, et que
`DATABASE_URL` pointe vers la base voulue. Le script accepte uniquement une
origine HTTP `localhost` ou `127.0.0.1`, sans chemin, et ne suit pas les
redirections.

Depuis la racine du dépôt, dans PowerShell :

```powershell
k6 run .\load-tests\smoke.js
```

Par défaut : `http://localhost:3000`, 1 VU, 10 secondes et une seconde de pause
entre les itérations. On peut définir `$env:BASE_URL` pour un autre port local et
`$env:DURATION_SECONDS` pour une durée entière de 1 à 30 secondes. Ne surchargez
pas les options k6 pour augmenter le nombre de VU ou la charge.

Pour inclure le plan de salle, choisir une séance existante dans les données
locales et un UUID de session de test (sans données personnelles) :

```powershell
$env:INCLUDE_SEATS = 'true'
$env:SHOWTIME_ID = '<id-de-seance>'
$env:SEAT_SESSION_TOKEN = '<uuid-de-session>'
k6 run .\load-tests\smoke.js
Remove-Item Env:\INCLUDE_SEATS, Env:\SHOWTIME_ID, Env:\SEAT_SESSION_TOKEN
```

Sans `INCLUDE_SEATS=true`, aucun plan de salle n'est appelé. Chaque réponse doit
être HTTP 200 et le p95 de chaque route appelée inférieur à 2 000 ms ; k6 retourne
un code d'échec si ces seuils ne sont pas respectés. Une séance inexistante,
une API ou une base indisponible peut donc faire échouer le test.

## Étape 3 — verrouillage/libération d'un siège de test

N'exécutez ce scénario qu'après avoir identifié dans le plan de salle un siège
disponible dédié aux essais. Un verrou peut bloquer le siège jusqu'à 10 minutes
si la libération échoue ou si l'exécution est interrompue. Le `finally` du script
tente la libération dès qu'une requête de verrouillage a été tentée, y compris si
la réponse du verrouillage est inattendue. Le test échoue si les contrôles ou
seuils ne passent pas.

Dans PowerShell, depuis la racine du dépôt, renseignez les identifiants de test
et activez explicitement le mode :

```powershell
$env:HOLD_TEST = 'true'
$env:SHOWTIME_ID = '<id-de-seance-de-test>'
$env:SEAT_ID = '<id-api-du-siege-de-test>'
$env:SEAT_SESSION_TOKEN = '<uuid-aleatoire-de-session-de-test>'
k6 run .\load-tests\smoke.js
Remove-Item Env:\HOLD_TEST, Env:\SHOWTIME_ID, Env:\SEAT_ID, Env:\SEAT_SESSION_TOKEN
```

`SEAT_ID` doit être l'identifiant du siège renvoyé par l'API du plan de salle,
pas son libellé visible (par exemple `A1`).

Le scénario force une seule itération et un seul VU ; ne surchargez pas les
options k6. Il vérifie que le siège est disponible avant toute écriture, puis
que le verrou appartient à la session de test et que le siège est de nouveau
disponible après la libération.

Si k6 signale un échec de libération, vérifiez immédiatement le plan de salle.
Pour retenter manuellement la libération du seul siège avec le même UUID de
session, tant que les variables sont définies :

```powershell
$headers = @{ 'x-seat-session-token' = $env:SEAT_SESSION_TOKEN }
$body = @{ seatIds = @($env:SEAT_ID) } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Delete `
  -Uri "http://localhost:3000/api/showtimes/$env:SHOWTIME_ID/seats/holds" `
  -Headers $headers -ContentType 'application/json' -Body $body
```

Si la libération reste impossible, le verrou expire automatiquement au plus tard
10 minutes après sa création. Vérifiez ensuite que le siège est disponible avant
de quitter le test.
