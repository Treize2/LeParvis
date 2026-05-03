# Bootstrap LeParvis sur l'instance Scaleway (mutualisée avec taskrabbit)

> Hypothèses : taskrabbit est déjà déployé sur l'instance, sa stack Caddy gère
> le TLS pour `*.dauchez.me`, et l'utilisateur de déploiement est le même.

## 1. Pré-requis (déjà en place pour taskrabbit)

- Docker + docker compose v2
- Utilisateur SSH (ex. `campus`) dans le groupe `docker`
- Caddy taskrabbit en cours d'exécution avec un volume monté sur sa
  configuration

## 2. Créer le réseau Docker partagé (une seule fois)

Si taskrabbit n'a pas déjà un réseau externe nommé `web`, créez-le :

```bash
docker network ls | grep -E '^[^ ]+ +web ' || docker network create web
```

Puis vérifiez que Caddy de taskrabbit est attaché à ce réseau (ajoutez
`networks: [web]` à son service dans son docker-compose si besoin, et
déclarez le réseau comme `external: true`).

## 3. Cloner le repo LeParvis

```bash
cd "$HOME"
git clone https://github.com/Treize2/LeParvis.git
cd LeParvis
cp deploy/env.example .env
$EDITOR .env       # vérifier DOMAIN_NAME, SCW_NAMESPACE, etc.
```

## 4. Configurer les secrets côté GitHub

Repository → Settings → Secrets and variables → Actions :

**Secrets** (déjà connus de taskrabbit, à recopier ici) :

| Nom                 | Valeur                                                       |
|---------------------|--------------------------------------------------------------|
| `SCW_SECRET_KEY`    | Clé secrète Scaleway (rôle ContainerRegistryFullAccess)      |
| `SCALEWAY_HOST`     | IP/DNS publique de l'instance                                |
| `SCALEWAY_USER`     | Utilisateur SSH (ex. `campus`)                               |
| `SCALEWAY_SSH_KEY`  | Clé privée PEM autorisée pour cet utilisateur                |
| `SCALEWAY_HOST_KEY` | Sortie de `ssh-keyscan <host>` capturée localement           |
| `SCALEWAY_SSH_PORT` | (facultatif) Port SSH si ≠ 22                                |

**Variables** :

| Nom              | Valeur            | Défaut    |
|------------------|-------------------|-----------|
| `SCW_NAMESPACE`  | Namespace SCR     | `treize`  |

> Capture du host key :
> ```bash
> ssh-keyscan -t ed25519,rsa <host> > host_key.txt
> ```

## 5. Créer les images dans Scaleway Container Registry

Une seule fois, dans la console Scaleway :

1. Container Registry → Namespace `treize` (ou autre).
2. Créer deux images : `leparvis-api` et `leparvis-web` (visibilité privée).

Le premier `git push origin main` les remplira via la pipeline.

## 6. Activer la console d'administration

```bash
cd "$HOME/LeParvis"
TOKEN=$(openssl rand -hex 24)
echo "LEPARVIS_ADMIN_TOKEN=$TOKEN" >> .env
echo "Token admin : $TOKEN"        # à conserver précieusement
```

> Le `docker-compose.yml` propage déjà cette variable au container API.
> Pour qu'elle soit prise en compte, il faut redémarrer le service :
> ```bash
> docker compose up -d api
> ```
> Vérification rapide :
> ```bash
> curl -X POST -H "Authorization: Bearer $TOKEN" \
>   http://localhost:8000/api/admin/login    # → {"status":"ok"}
> ```
> Sans token sur le `.env`, le endpoint renvoie 503 (admin désactivé).

## 7. Initialiser le volume SQLite et amorcer la base

```bash
cd "$HOME/LeParvis"
docker compose pull api          # tire la dernière image
docker compose run --rm api python -m app.seed
```

## 8. Brancher le vhost dans le Caddy taskrabbit

Copier le contenu de `deploy/Caddyfile.snippet` dans le Caddyfile que
taskrabbit utilise (ou un fichier `*.caddy` qu'il importe), puis recharger :

```bash
# adapte ce chemin à ce que fait taskrabbit
cd "$HOME/TaskRabbit"
docker compose exec edge caddy reload --config /etc/caddy/Caddyfile
```

Vérifier la résolution DNS :

```bash
dig +short leparvis.dauchez.me      # doit pointer sur l'IP de l'instance
```

## 9. Premier déploiement

Push sur `main` (ou merge automatique via le workflow `auto-merge`) →
le workflow `ci` tourne → s'il est vert, `deploy` se déclenche, build + push
des images dans SCR puis SSH + `docker compose up -d` sur l'instance.

Vérification :

```bash
curl -fsSL https://leparvis.dauchez.me/health     # {"status":"ok"}
curl -fsSL https://leparvis.dauchez.me/api/meta/taxonomy | head
```

## 10. Diagnostic en cas de problème

Sur l'instance :

```bash
cd "$HOME/LeParvis"
docker compose ps                       # statut des services
docker compose logs --tail 100 api
docker compose logs --tail 100 web
docker network inspect web              # vérifier que Caddy + leparvis-* y sont
```

Côté Caddy taskrabbit :

```bash
docker compose -f $HOME/TaskRabbit/docker-compose.yml logs edge --tail 50
```

## 11. Note sur Playwright (Chromium headless)

L'image API contient désormais Chromium (~400 Mo) pour rendre les pages
SPA comme messes.info via `render=true`. Conséquences :

- Premier `docker compose pull api` plus lent (image plus grosse).
- Aucun impact si tu n'utilises pas l'option « 🌐 Rendre le JavaScript »
  ou les sites SPA — Chromium est lancé à la demande seulement.
- Chromium tourne en `--no-sandbox --disable-dev-shm-usage` (obligatoire
  dans un container).
- Si tu vois des erreurs OOM lors du rendu, augmente la RAM allouée :
  ```yaml
  api:
    shm_size: '2gb'   # à ajouter dans docker-compose.yml
  ```

## 12. Désinstallation propre

```bash
cd "$HOME/LeParvis"
docker compose down -v        # ⚠ supprime aussi le volume SQLite
# retirer le bloc leparvis.dauchez.me du Caddyfile taskrabbit + reload
```
