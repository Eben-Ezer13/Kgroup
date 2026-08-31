# Déployer KGROUP sur Netlify

Le projet est prêt : `npm run build` valide tout et assemble `dist/`.
Il ne reste que la configuration côté Netlify.

---

## 1. Ce que Netlify doit exécuter

Ces valeurs sont déjà dans [`netlify.toml`](netlify.toml) — vérifiez simplement
qu'elles correspondent dans **Project configuration → Build & deploy** :

> Netlify a renommé « Site settings » en **« Project configuration »**. C'est
> la même chose, dans le menu de gauche du projet.

| Réglage | Valeur |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |

> `dist/` est régénéré à chaque build et **ignoré par git** — ne le commitez pas.

---

## 2. Variables d'environnement

**Project configuration → Environment variables → Add a variable.**

> Anciennement « Site settings ». Si vous ne voyez pas l'entrée, elle est dans
> le menu du **projet** (colonne de droite sur la capture), pas dans celui de
> l'équipe (colonne de gauche : Projects, Builds, Members…).

Les valeurs sont dans votre fichier `.env` local. **Copiez-les depuis là** — ce
fichier ne doit jamais être commité ni partagé.

### Requises — sans elles, l'API ne démarre pas

| Variable | Où la trouver |
| --- | --- |
| `DATABASE_URL` | votre `.env` (chaîne Neon **pooled**, celle avec `-pooler`) |
| `JWT_SECRET` | votre `.env` (≥ 32 caractères) |
| `NODE_ENV` | à saisir : `production` |

> `NODE_ENV=production` active le cookie de session `Secure` et fait échouer le
> démarrage si `JWT_SECRET` est absent — c'est un garde-fou voulu.

> **Extension Neon de Netlify.** Si vous l'utilisez (section *Database* du
> projet), elle injecte automatiquement `NETLIFY_DATABASE_URL` — l'application
> l'accepte aussi, vous n'avez alors rien à saisir.
>
> ⚠️ Mais si l'extension provisionne une base **neuve**, celle-ci sera **vide** :
> votre schéma et vos données sont dans la base Neon existante, celle de votre
> `.env`. Dans ce cas, définissez `DATABASE_URL` à la main — elle est
> prioritaire sur `NETLIFY_DATABASE_URL`.

### Recommandées

| Variable | Valeur | Sans elle |
| --- | --- | --- |
| `APP_URL` | `https://VOTRE-SITE.netlify.app/` (avec le `/` final) | les liens de réinitialisation pointent vers une URL devinée |
| `CRON_SECRET` | votre `.env` | les rappels d'anniversaire ne se déclenchent pas (l'endpoint renvoie 503) |
| `NODE_VERSION` | `22` | Netlify choisit une version par défaut qui peut changer |

### Optionnelles

| Variable | Active |
| --- | --- |
| `RESEND_API_KEY`, `MAIL_FROM` | l'envoi réel des e-mails de réinitialisation |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | le bouton « Continuer avec Google » |

Pour Google, l'URI de redirection autorisée à déclarer dans Google Cloud est :
`https://VOTRE-SITE.netlify.app/api/auth/google/callback`

---

## 3. Déployer

### Option A — Netlify CLI (sans git)

```bash
cd C:\Users\pc\Downloads\kgroup\kgroup

npx netlify-cli login          # ouvre le navigateur
npx netlify-cli link           # rattache au site existant
npx netlify-cli deploy --build # aperçu, sur une URL temporaire
npx netlify-cli deploy --build --prod   # mise en production
```

Déployez d'abord **sans** `--prod` : vous obtenez une URL d'aperçu pour vérifier
avant de basculer le site public.

### Option B — Git + GitHub (redéploiement automatique)

```bash
cd C:\Users\pc\Downloads\kgroup\kgroup
git init
git add .
git commit -m "KGROUP — migration Neon, CRM clients, formation, rémunération"
git branch -M main
git remote add origin https://github.com/VOUS/kgroup.git
git push -u origin main
```

Puis dans Netlify : **Add new site → Import an existing project → GitHub**.

> `.gitignore` exclut déjà `.env`, `dist/` et `node_modules/`.
> **Vérifiez avant de pousser** : `git status` ne doit montrer aucun `.env`.

---

## 4. Vérifier après déploiement

```bash
# L'API répond et voit la base
curl https://VOTRE-SITE.netlify.app/api/health
# attendu : {"ok":true,"database":"neon","connected":true}
```

Puis, dans le navigateur :

1. `/login.html` s'affiche sans bandeau « Mode démo ».
   *(le bandeau signifie que l'API est injoignable — voir §5)*
2. Créez un compte, enregistrez une vente avec un numéro de téléphone.
3. Le client apparaît dans **Clients**.
4. **Rémunération** affiche les commissions.

### Les rappels d'anniversaire

Netlify exécute `birthday-cron` toutes les heures. Vérifiez dans
**Project configuration → Functions** que `birthday-cron` est listée comme *Scheduled*.

Pour un test immédiat :

```bash
curl -X POST https://VOTRE-SITE.netlify.app/api/reminders/run \
  -H "x-cron-secret: VOTRE_CRON_SECRET"
```

---

## 5. Si quelque chose ne marche pas

| Symptôme | Cause probable | Correctif |
| --- | --- | --- |
| Bandeau « Mode démo » sur la page de connexion | `/api/health` ne répond pas | Vérifiez `DATABASE_URL` dans les variables Netlify, puis **Deploys → Trigger deploy → Clear cache and deploy** |
| `/api/health` renvoie 503 | La base est injoignable | Chaîne Neon incorrecte, ou projet Neon en veille — ouvrez la console Neon |
| Erreur 500 sur `/api/health` | `JWT_SECRET` absent ou trop court | Ajoutez-le (≥ 32 caractères), puis redéployez |
| Le build échoue | Une vérification a sauté | Le log Netlify montre l'erreur exacte ; reproduisez avec `npm run build` en local |
| Les rappels ne partent pas | `CRON_SECRET` absent, ou fonctions planifiées non disponibles sur votre offre | Ajoutez la variable ; sinon utilisez un cron externe qui appelle `/api/reminders/run` |
| Déconnexion à chaque visite | `JWT_SECRET` change entre les déploiements | Définissez-le **une fois** dans Netlify et n'y touchez plus |

---

## 6. Règles à ne pas enfreindre

- **`.env` ne doit jamais être commité ni téléversé.** Il est dans `.gitignore`,
  et `npm run lint` échoue si un secret apparaît dans un fichier suivi.
- **`DATABASE_URL` reste côté serveur.** Elle n'existe que dans les variables
  Netlify et dans la fonction `/api`. Le dossier `dist/` publié sur le CDN ne
  contient que du HTML, CSS, JS de page et des images — 30 fichiers, aucun code
  serveur.
- **Ne changez pas `JWT_SECRET`** une fois en production : toutes les sessions
  actives seraient invalidées.
- **Un mois de paie clôturé ne se recalcule pas.** Modifier les paramètres de
  rémunération n'affecte que les mois en cours.
