# Pointe ta journée

Site pour vérifier que ses heures (et ses heures sup) ont bien été payées.

- `index.html` : page d'accueil, avec la vérification gratuite (une seule fois) et le calcul des congés payés.
- `app.html` : l'application (calendrier du mois, heures sup, congés, absences, paie, contrat).
- `calc.js` : tous les calculs (cotisations selon le contrat, heures sup, précarité, congés payés).
- `site.css` : les couleurs et les styles communs.
- `robots.txt`, `sitemap.xml` : pour que Google trouve le site.

- `api/send-report.js` : fonction Vercel qui envoie le relevé d'heures à l'employeur par e-mail (option Plus).
- `api/read-payslip.js` : fonction Vercel qui lit une fiche de paie (photo ou PDF) avec Claude. L'app compare ensuite les heures sup, les paniers et le taux horaire avec les heures notées (option Plus).
- `api/read-hours.js` : fonction Vercel qui lit une photo d'heures (feuille de pointage, planning, carnet) avec Claude et propose les jours trouvés (option Plus). Rien n'est enregistré sans vérification.

Les heures restent dans le navigateur de la personne. Seul le relevé passe par le serveur au moment de l'envoi, sans être gardé.

### Brancher l'envoi des relevés par e-mail

1. Créez un compte gratuit sur https://resend.com (3 000 e-mails par mois offerts).
2. **Domains → Add Domain** : ajoutez votre domaine (ex. `pointetajournee.fr`) et copiez les lignes DNS qu'il donne chez votre registrar. Sans domaine vérifié, Resend n'envoie qu'à votre propre adresse.
3. **API Keys → Create API Key**, puis copiez la clé.
4. Dans Vercel → projet → **Settings → Environment Variables**, ajoutez :
   - `RESEND_API_KEY` = la clé
   - `MAIL_FROM` = `Pointe ta journée <releve@pointetajournee.fr>`
5. **Deployments → Redeploy**. Tant que ces variables manquent, l'app propose d'envoyer le relevé depuis la boîte mail du téléphone.

L'envoi part à la première ouverture de l'app après la fin de la semaine (le lundi) ou du mois (le 1er).

### Brancher la lecture des heures en photo et des fiches de paie

La même clé sert aux deux lectures.

1. Créez un compte sur https://console.anthropic.com et ajoutez un moyen de paiement (**Settings → Billing**, quelques euros suffisent pour commencer).
2. **API Keys → Create Key**, puis copiez la clé (elle commence par `sk-ant-`).
3. Dans Vercel → projet → **Settings → Environment Variables**, ajoutez `ANTHROPIC_API_KEY` = la clé.
4. **Deployments → Redeploy**. Tant que la clé manque, l'app affiche « Bientôt disponible » à la place de la lecture.

Chaque photo coûte quelques centimes. La photo n'est pas gardée : elle part à Claude, les jours reviennent, c'est tout.

---

## Mettre le site en ligne, pas à pas

### 1. Créer le dépôt GitHub

1. Allez sur https://github.com/new
2. Nom du dépôt : `fin-de-chantier`, laissez-le **Private** si vous préférez, puis cliquez sur **Create repository**.
3. Sur la page du dépôt vide, cliquez sur **uploading an existing file** et glissez tous les fichiers de ce dossier.
   (Ou, si vous avez connecté GitHub à Claude, Claude peut pousser les fichiers pour vous.)
4. Cliquez sur **Commit changes**.

### 2. Mettre en ligne avec Vercel (gratuit)

1. Allez sur https://vercel.com et connectez-vous **avec votre compte GitHub**.
2. Cliquez sur **Add New… → Project**, puis **Import** à côté de `fin-de-chantier`.
3. Framework Preset : **Other**. Ne changez rien d'autre, cliquez sur **Deploy**.
4. Au bout de quelques secondes, le site est en ligne sur une adresse du type `fin-de-chantier.vercel.app`.
5. À chaque modification poussée sur GitHub, Vercel remet le site à jour tout seul.

Pour un vrai nom de domaine (ex. `pointetajournee.fr`, environ 10 €/an) : Vercel → votre projet → **Settings → Domains → Add**.
Pensez alors à remplacer `pointetajournee.vercel.app` dans `index.html` (balise `canonical`), `robots.txt` et `sitemap.xml`.

### 3. Apparaître sur Google

1. Allez sur https://search.google.com/search-console et ajoutez l'adresse de votre site.
2. Choisissez la vérification par **balise HTML** : Google donne une ligne `<meta name="google-site-verification" …>`. Collez-la dans le `<head>` de `index.html`, poussez sur GitHub, puis cliquez sur **Valider**.
3. Dans **Sitemaps**, ajoutez `sitemap.xml`.
4. Google met en général quelques jours à afficher le site dans les résultats.

### 4. Railway : pour plus tard

Railway sert à faire tourner un **serveur**. On en aura besoin pour trois choses que le site ne peut pas faire seul :

- **Les comptes** : pour que la vérification gratuite soit vraiment limitée à une fois par personne (aujourd'hui, elle est limitée par navigateur).
- **Le paiement à 2 €/mois** : avec Stripe, le serveur reçoit la confirmation de paiement et active l'abonnement.
- **L'IA qui lit la fiche de paie** : le serveur envoie la photo à l'IA avec une clé secrète qui ne doit jamais être dans le site.

Le site reste sur Vercel, et le serveur sur Railway (ou directement en fonctions Vercel). On le branchera quand vous aurez un compte Stripe.

---

## Règles de calcul utilisées

- Heures sup : au-delà de 35 h par semaine, +25 % pour les 8 premières, +50 % ensuite. Réduction de cotisations de 11,31 % sur ces heures.
- Cotisations salariales estimées : ouvrier 22 %, ETAM 22,5 %, cadre 25 %, apprenti 0 %.
- CDD et intérim : prime de précarité 10 % et indemnité de congés payés 10 %.
- Congés payés : 2,5 jours ouvrables par mois, période du 1er juin au 31 mai. Valeur d'un jour : la plus haute entre le maintien du salaire et le dixième.
- Maladie : 3 jours de carence, puis 50 % du salaire journalier de base versé par la Sécurité sociale.

Ce sont des règles générales : une convention collective peut prévoir mieux.
