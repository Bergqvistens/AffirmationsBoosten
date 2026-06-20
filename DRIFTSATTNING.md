# 🚀 Driftsättningsguide — AffirmationsBoosten

## Vad du får
- ✅ Säker inloggning med krypterade lösenord
- ✅ 7 dagars gratis provperiod → betalvägg
- ✅ Admin-panel på /admin (bara du kan komma åt)
- ✅ Alla affirmationer lagras på servern (kunder kan INTE se koden)
- ✅ JWT-autentisering (banknivå-säkerhet)
- ✅ Redo för Railway.app (gratis hosting)

---

## STEG 1 — Skapa konton (gratis)

1. Gå till **https://github.com** → Skapa ett konto (gratis)
2. Gå till **https://railway.app** → Logga in med GitHub

---

## STEG 2 — Ladda upp koden till GitHub

1. Gå till github.com → Klicka **"New repository"**
2. Namnge det: `affirmationsboosten`
3. Klicka **"Create repository"**
4. Ladda upp alla filerna från mappen du fått:
   - Dra och släpp filerna i GitHub-webbläsaren, ELLER
   - Använd GitHub Desktop (ladda ner på desktop.github.com)

Filstruktur att ladda upp:
```
affirmationsboosten/
├── package.json
├── railway.json
├── server/
│   └── index.js
└── public/
    ├── index.html    (kundappen)
    └── admin.html    (din admin-panel)
```

---

## STEG 3 — Driftsätt på Railway

1. Gå till **https://railway.app**
2. Klicka **"New Project"**
3. Välj **"Deploy from GitHub repo"**
4. Välj ditt `affirmationsboosten` repository
5. Railway bygger och startar appen automatiskt (tar ~2 minuter)

---

## STEG 4 — Sätt miljövariabler (VIKTIGT för säkerhet!)

I Railway → ditt projekt → **"Variables"** → lägg till:

| Variabel | Värde | Beskrivning |
|----------|-------|-------------|
| `JWT_SECRET` | `[välj ett långt slumpmässigt lösenord, t.ex. 64 tecken]` | Krypterar alla tokens |
| `ADMIN_PASSWORD` | `[ditt hemliga admin-lösenord]` | Lösenord till admin-panelen |
| `ADMIN_EMAIL` | `admin@affirmationsboosten.se` | Din admin-e-post |

⚠️ **VIKTIGT:** JWT_SECRET ska vara MINST 32 slumpmässiga tecken.
Exempel: `xK9#mP2$vL8nQ5@wR3jT6&yU1hF4cE7i`

Klicka **"Deploy"** efter att du lagt till variablerna.

---

## STEG 5 — Hämta din app-URL

I Railway → ditt projekt → **"Settings"** → **"Domains"** → Klicka **"Generate Domain"**

Du får en URL som: `affirmationsboosten-production.up.railway.app`

**Det är din app! Dela den med kunder.**

---

## STEG 6 — Logga in som admin

1. Gå till: `din-url.railway.app/admin`
2. E-post: det du satte i `ADMIN_EMAIL`
3. Lösenord: det du satte i `ADMIN_PASSWORD`

### I admin-panelen kan du:
- 👥 **Användare** — Se alla kunder, markera dem som betalda
- ✨ **Affirmationer** — Redigera, lägg till, ta bort affirmationer
- ⚙️ **Inställningar** — Ändra provperiodlängd och pris

---

## STEG 7 — Anpassa domän (valfritt)

Om du köper en domän (t.ex. affirmationsboosten.se på loopia.se):
1. I Railway → Settings → Domains → "Custom Domain"
2. Skriv in din domän
3. Hos din domänleverantör: lägg till DNS-posten Railway visar

---

## Säkerhetsöversikt

| Funktion | Status |
|----------|--------|
| Lösenord krypterade (bcrypt) | ✅ |
| JWT-tokens (30 dagars giltighetstid) | ✅ |
| Admin-skyddad med separat autentisering | ✅ |
| Affirmationer lagras på server (ej synliga för kunder) | ✅ |
| HTTPS (Railway sköter detta automatiskt) | ✅ |
| Kunder kan INTE redigera frontend eller backend | ✅ |

---

## Lägga till betalning (Stripe) — nästa steg

När du är redo att ta betalt på riktigt:
1. Skapa konto på **https://stripe.com**
2. Meddela mig — jag lägger till Stripe-integrationen i koden
3. Kunder betalar → Stripe meddelar din server → du markerar dem som betalda automatiskt

---

## Support

Vid frågor, öppna Railway-loggar under:
Ditt projekt → **"Deployments"** → Senaste deployment → **"View Logs"**

