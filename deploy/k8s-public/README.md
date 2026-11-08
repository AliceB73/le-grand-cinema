# Exposition publique de l'API (préproduction)

Ces manifests ne sont pas dans `deploy/k8s/` pour ne pas être appliqués par
erreur. Ils créent un Load Balancer facturé à l'heure.

Prérequis : `helm` (`winget install Helm.Helm`) et `$Kubeconfig` défini dans
le terminal.

Ingress Controller : Traefik. ingress-nginx a échoué sur ce cluster
(`kill(...) failed (13: Permission denied)` au rechargement de nginx).

1. Installer Traefik (crée le Load Balancer) :
   `helm upgrade --install traefik traefik --repo https://traefik.github.io/charts --namespace traefik --create-namespace --kubeconfig $Kubeconfig`
2. Récupérer l'IP publique (colonne EXTERNAL-IP) :
   `kubectl --kubeconfig $Kubeconfig get svc -n traefik traefik`
3. Installer cert-manager :
   `helm upgrade --install cert-manager cert-manager --repo https://charts.jetstack.io --namespace cert-manager --create-namespace --set crds.enabled=true --kubeconfig $Kubeconfig`
4. Remplacer dans `cluster-issuer.yaml` l'e-mail, et dans `ingress.yaml`
   `REMPLACER_IP_AVEC_TIRETS` par l'IP avec des tirets (`1.2.3.4` devient
   `1-2-3-4`), puis :
   `kubectl --kubeconfig $Kubeconfig apply -f .\deploy\k8s-public\`
5. Vérifier : `kubectl --kubeconfig $Kubeconfig get certificate -n le-grand-cinema-preprod`
   puis `https://api.<IP-avec-tirets>.nip.io/api/health`.

Si Let's Encrypt refuse nip.io (limite de domaine partagé), utiliser sslip.io
avec le même format de nom.
