# handoff

**Un agent IA a besoin d'une clé API. Il ne la demande plus dans le chat.**

Il appelle `POST /v1/requests`, récupère un lien, te l'envoie. Tu ouvres le lien, tu colles ta clé,
l'agent la récupère une fois. La valeur ne traîne pas dans l'historique Telegram, Discord ou Slack.

Le secret est **chiffré dans ton navigateur** avant d'être envoyé : le serveur ne le voit jamais
en clair et la base de données seule ne permet pas de le lire.

> V1. Un seul outil : la demande de secret. Le reste de la suite viendra après.

---

## Le flux

```
  Agent                        handoff                       Humain
    │                             │                             │
    │ POST /v1/requests           │                             │
    │────────────────────────────>│                             │
    │  { url, poll_token,         │                             │
    │    encryption_key }         │                             │
    │<────────────────────────────│                             │
    │                             │                             │
    │  « ouvre ce lien »          │                             │
    │─────────────────────────────────────────────────────────> │
    │                             │  GET /s/:id#clé             │
    │                             │<────────────────────────────│
    │                             │  POST /s/:id  (chiffré)     │
    │                             │<────────────────────────────│
    │ GET /v1/requests/:id        │                             │
    │────────────────────────────>│                             │
    │  status: filled             │                             │
    │<────────────────────────────│                             │
    │ POST /v1/requests/:id/reveal│                             │
    │────────────────────────────>│                             │
    │  { secret }   puis détruit  │                             │
    │<────────────────────────────│                             │
```

---

## Démarrer

```bash
npm install
cp .env.example .env

# Génère une vraie clé API et un vrai sel
node -e "console.log('API_KEYS=' + require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('IP_HASH_SALT=' + require('crypto').randomBytes(16).toString('hex'))"

npm start          # http://localhost:8787
```

Tests :

```bash
npm test                      # 45 assertions sur le flux et les contrôles d'accès
node test/browser.mjs         # rejoue le parcours dans un vrai Chromium + captures d'écran
```

---

## Utilisation

**1. L'agent crée la demande**

```bash
curl -X POST http://localhost:8787/v1/requests \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "requester": "Assistant Telegram",
    "label": "Clé API Gmail",
    "purpose": "Lire tes 20 derniers mails pour te faire un résumé chaque matin",
    "ttl_seconds": 900
  }'
```

```json
{
  "id": "k3mq7rz2xp9wd4nb",
  "status": "pending",
  "url": "http://localhost:8787/s/k3mq7rz2xp9wd4nb#Xy7f...",
  "poll_token": "aB3x...",
  "encryption_key": "Xy7f...",
  "expires_in_seconds": 900
}
```

L'agent envoie **`url`** à son humain. Il garde `poll_token` et `encryption_key` : les deux sont
nécessaires pour lire le secret, et **aucun des deux ne doit être affiché à l'utilisateur**.

**2. L'agent sonde**

```bash
curl http://localhost:8787/v1/requests/k3mq7rz2xp9wd4nb \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Poll-Token: aB3x..."
```

`status` passe de `pending` à `filled`. La réponse contient aussi `opened_count`,
`filled_at` et `filled_from_ip_hash` — de quoi signaler une anomalie à l'humain.

**3. L'agent révèle, au dernier moment**

```bash
curl -X POST http://localhost:8787/v1/requests/k3mq7rz2xp9wd4nb/reveal \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"poll_token": "aB3x...", "encryption_key": "Xy7f..."}'
```

```json
{ "secret": "AIzaSy...", "burned": true }
```

Par défaut le secret est **détruit immédiatement après cette lecture**. À n'appeler qu'au moment
de s'en servir. Pour garder le secret lisible jusqu'à expiration, passer `burn_on_reveal: false`
à la création.

---

## Brancher un agent

La spec est servie sur `/openapi.json` et rédigée pour être chargée telle quelle comme définition
d'outil. Les `description` sont écrites pour le modèle, pas pour un humain.

Bout de prompt système qui marche bien :

```
Tu ne demandes JAMAIS une clé API, un token ou un mot de passe directement dans la conversation.
Quand tu as besoin d'un secret :
  1. appelle createSecretRequest avec requester, label et purpose (sois précis sur purpose,
     l'humain le lit pour décider)
  2. donne UNIQUEMENT le champ "url" à l'utilisateur, jamais poll_token ni encryption_key
  3. sonde getSecretRequest jusqu'à status == "filled"
  4. n'appelle revealSecret qu'au moment exact où tu vas t'en servir : le secret est détruit
     à la lecture
  5. si opened_count > 1, préviens l'utilisateur que le lien a été ouvert plusieurs fois
Ne recopie jamais un secret révélé dans ta réponse.
```

---

## Ce que ça protège, et ce que ça ne protège pas

Autant être direct : c'est ça qui compte dans un outil pareil.

**Protégé**

- **L'historique de conversation.** Le secret ne transite jamais par Telegram, Discord ou Slack.
  C'est le gain principal, et il est réel : un chat est persistant, synchronisé, sauvegardé et
  indexé, alors que ce lien vit quinze minutes.
- **Le serveur, et une fuite de base.** Le navigateur chiffre en AES-GCM 256 avec une clé qui vit
  dans le fragment `#` de l'URL — un fragment n'est jamais transmis au serveur. Une copie de la
  base ne contient que du chiffré inexploitable.
- **Les logs.** Le journal ne contient que méthode, chemin normalisé, statut et durée. Ni corps,
  ni en-têtes, ni query string.
- **Le vol par un lecteur du chat.** Révéler exige le `poll_token`, que seul l'agent détient.
  Quelqu'un qui lit le lien dans la conversation ne peut pas lire le secret.
- **La réutilisation.** Un lien accepte une valeur, une seule fois. Le secret se lit une fois.

**Non protégé**

- **Le contexte de l'agent.** Une fois révélé, le secret est dans la fenêtre de contexte du modèle,
  donc potentiellement dans les logs du fournisseur. C'est la limite structurelle de cette V1.
  La suite, c'est le mode proxy : l'agent garde un handle, le service injecte le credential dans
  l'appel HTTP, le modèle ne voit jamais la valeur.
- **L'injection.** Quelqu'un qui lit le lien avant toi peut remplir le slot avec *sa* valeur, et
  ton agent travaillera alors sur le compte de l'attaquant. C'est pour ça que `opened_count`,
  `filled_at` et `filled_from_ip_hash` sont exposés — l'agent doit les surveiller et alerter.
- **Un agent compromis.** Un agent victime d'une injection de prompt peut générer un lien d'allure
  légitime pour exfiltrer. La page affiche demandeur, demande et motif **fixés à la création**,
  mais rien ne remplace la vigilance de l'humain. D'où l'avertissement en bas du formulaire.
- **Le poste de l'humain.** Keylogger, presse-papier, extension malveillante : hors périmètre.

**Traite l'URL comme un porteur.** Elle contient la clé de déchiffrement. TTL court, un seul usage,
et **HTTPS obligatoire en production** — le serveur émet un avertissement si `BASE_URL` n'est pas en
`https://`.

---

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8787` | Port d'écoute |
| `BASE_URL` | `http://localhost:8787` | URL publique, celle mise dans le lien |
| `API_KEYS` | — | Clés agent acceptées, séparées par des virgules |
| `DB_PATH` | `./data/handoff.db` | Fichier SQLite |
| `DEFAULT_TTL_SECONDS` | `900` | Durée de vie par défaut |
| `MAX_TTL_SECONDS` | `86400` | Plafond |
| `MAX_SECRET_BYTES` | `8192` | Taille max de la valeur |
| `RATE_LIMIT_PER_MIN` | `60` | Requêtes par minute et par clé API |
| `IP_HASH_SALT` | — | Sel de hachage des IP (jamais d'IP en clair) |

Un balayage toutes les 30 s efface le contenu chiffré des demandes expirées et supprime
définitivement les lignes terminées depuis plus de 7 jours.

---

## Déploiement

```bash
docker build -t handoff .
docker run -d --name handoff -p 8787:8787 \
  -e BASE_URL=https://handoff.example.com \
  -e API_KEYS=$(openssl rand -base64 32 | tr -d '=+/') \
  -e IP_HASH_SALT=$(openssl rand -hex 16) \
  -v handoff-data:/app/data \
  handoff
```

Derrière un reverse proxy TLS. Pense à transmettre `X-Forwarded-For` pour que l'empreinte IP
de remplissage soit exploitable.

---

## Prochaine étape

Le mode proxy (`POST /proxy/:handle`) : l'agent ne lit plus jamais le secret, il demande au service
d'exécuter l'appel HTTP avec le credential injecté. C'est ce qui ferme le dernier trou — le secret
sort complètement de la fenêtre de contexte du modèle.

## Licence

MIT
