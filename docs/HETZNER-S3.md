# Hetzner Object Storage (S3) – opsætning trin for trin

Denne guide er til dig som ejer. Når den er fulgt, gemmer appen optagelser og rådgiverfotos i en **privat** bucket hos
Hetzner i Tyskland eller Finland i stedet for på serverens disk. Det tager ca. 20 minutter.

**Hvad gemmes i bucketten?**

| Mappe (præfiks) | Indhold | Hvor længe |
|---|---|---|
| `recordings/<møde-id>/…` | Optagelser af møder (upload eller fra Whereby) | Slettes efter transskription (`DELETE_RECORDINGS_AFTER_TRANSCRIPTION=true`) |
| `avatars/<rådgiver-id>/<tilfældig>.webp` og `…-96.webp` | Rådgiverfotos, 512 × 512 og 96 × 96 px, uden EXIF/GPS | Til de skiftes, fjernes eller rådgiveren slettes |
| `healthcheck/…` | Testobjekter fra `npm run storage:check` | Slettes med det samme |

Bucketten skal være **privat**. Ingen browser henter noget direkte fra den: fotos serveres af appen selv
(`/api/avatar/…`), og optagelser læses kun af serveren. Den eneste direkte trafik fra browseren til bucketten er
upload af optagelser (presigned POST), og den kræver en CORS-regel (trin 5).

---

## 1. Opret et projekt (anbefalet)

1. Log ind på **Hetzner Console** (<https://console.hetzner.com>).
2. Opret et projekt, fx **«ABU produktion»**, eller brug det projekt, serveren ligger i.

S3-nøgler hos Hetzner gælder for **alle buckets i projektet**. Et separat projekt (eller i hvert fald ingen andre
buckets i det) betyder, at appens nøgle kun kan nå appens data.

## 2. Opret bucketten

1. I projektet: **Object Storage → Create Bucket**.
2. **Location** – vælg én (alle er i EU):
   - `fsn1` – Falkenstein (DE)
   - `nbg1` – Nürnberg (DE)
   - `hel1` – Helsinki (FI)

   Vælg gerne samme sted som serveren (fx `fsn1`, hvis serveren står i Falkenstein). Det giver kortere svartider og ingen trafik på tværs af lande.
3. **Name**: fx `abu-prod-<noget-tilfældigt>` (kun små bogstaver, tal og bindestreg; navnet er globalt unikt).
4. **Visibility: Private.** Vælg aldrig «Public».
5. Tryk **Create & Buy now**.

Endpointet er `https://<location>.your-objectstorage.com`, fx `https://fsn1.your-objectstorage.com`.

## 3. Opret S3-nøgler

1. I projektet: **Security → S3 Credentials → Generate credentials**.
2. Giv dem en beskrivelse, fx «abu-app».
3. Kopiér **Access key** og **Secret key** med det samme. Hemmeligheden vises kun én gang.
4. Gem dem i din adgangskodemanager. Send dem aldrig på mail eller chat. De skal kun stå i serverens `.env`.

Rotation: opret nye nøgler, sæt dem i `.env`, genstart appen (`docker compose up -d`), kør `npm run storage:check`,
og slet derefter de gamle nøgler i Hetzner Console.

## 4. Sæt miljøvariablerne

I serverens `.env` (samme mappe som `docker-compose.yml`):

```bash
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://fsn1.your-objectstorage.com   # din location
S3_REGION=fsn1                                     # samme som location: fsn1, nbg1 eller hel1
S3_BUCKET=abu-prod-xxxx                            # navnet fra trin 2
S3_ACCESS_KEY_ID=…                                 # fra trin 3
S3_SECRET_ACCESS_KEY=…                             # fra trin 3
S3_FORCE_PATH_STYLE=true                           # standard; se nedenfor
```

- **`S3_FORCE_PATH_STYLE=true`** (standard) betyder adresser som `https://fsn1.your-objectstorage.com/<bucket>/<nøgle>`.
  Det virker hos Hetzner og gør, at CSP og CORS kun skal kende ét domæne (endpointet). Med `false` bruges
  `https://<bucket>.fsn1.your-objectstorage.com/<nøgle>`; appen retter selv CSP'en til. Lad den stå på `true`, medmindre der er en grund.
- `APP_URL` skal være jeres rigtige https-adresse, fx `https://app.abu.dk`. Den bruges i CORS-reglen herunder.
- Appens CSP (`connect-src`) får automatisk endpointet med, så browseren må uploade optagelser direkte. `img-src` er
  stadig kun `'self'`: ingen billeder hentes fra bucketten eller andre værter.

Genstart appen: `docker compose up -d`. Opstartsloggen viser `lager=s3`. Mangler en variabel, nægter appen at starte
og skriver, hvad der mangler.

## 5. CORS-regel (direkte upload af optagelser)

Når en rådgiver eller admin uploader en optagelse manuelt, sender browseren filen **direkte** til bucketten med en
kortlivet, signeret formular (presigned POST, højst 500 MB håndhævet af lageret). Bucketten skal derfor tillade
requests fra jeres app-adresse. Gem dette som `cors.json` (ret adressen til jeres `APP_URL`, uden `/` til sidst):

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://app.abu.dk"],
      "AllowedMethods": ["POST", "PUT", "GET"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

- **Kun jeres egen origin**, aldrig `*`.
- `POST` er det, appen bruger i dag (presigned POST). `PUT` er med til reserveløsningen med presigned PUT (se
  `docs/OPEN_ITEMS.md`), og `GET` gør det muligt at tjekke opsætningen fra browseren. Appen henter aldrig billeder
  direkte fra bucketten, så `GET` kan fjernes, hvis I vil være helt stramme.

Hetzner Console har (pr. oktober 2026) ingen formular til CORS, så reglen sættes med et S3-værktøj fra din egen
computer. Med AWS CLI (kun klientprogrammet; der sendes intet til AWS, når `--endpoint-url` peger på Hetzner):

```bash
export AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…
aws s3api put-bucket-cors --bucket abu-prod-xxxx --cors-configuration file://cors.json \
  --endpoint-url https://fsn1.your-objectstorage.com --region fsn1
aws s3api get-bucket-cors --bucket abu-prod-xxxx --endpoint-url https://fsn1.your-objectstorage.com --region fsn1
```

Alternativ: `s3cmd setcors cors.xml s3://abu-prod-xxxx` (s3cmd bruger XML-formatet med de samme felter).

## 6. Livscyklusregler (anbefalet)

Gem som `lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "afbrudte-multipart-uploads",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    },
    {
      "ID": "healthcheck-ryddes",
      "Status": "Enabled",
      "Filter": { "Prefix": "healthcheck/" },
      "Expiration": { "Days": 1 }
    },
    {
      "ID": "gamle-versioner-30-dage",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration --bucket abu-prod-xxxx --lifecycle-configuration file://lifecycle.json \
  --endpoint-url https://fsn1.your-objectstorage.com --region fsn1
```

- **Afbrudte multipart-uploads** fylder og koster, men kan ikke ses i bucketlisten. De ryddes efter 1 døgn.
- **`healthcheck/`** er en ekstra sikkerhed for testobjekterne fra `npm run storage:check`.
- **Gamle versioner** (kun relevant med versionering, trin 7) slettes efter 30 dage.
- Appen rydder selv op i ufærdige uploads af optagelser (efter et døgn) og sletter optagelser efter transskription.
  Lav **ikke** en udløbsregel på `avatars/`. Fotos skal ligge, til de skiftes eller fjernes.

Afviser Hetzner en enkelt regel, så sæt de andre og skriv til mig, så finder vi en løsning.

## 7. Backup og versionering

- **Slå versionering til** på bucketten (Hetzner Console → bucketten → *Versioning*, eller
  `aws s3api put-bucket-versioning --bucket abu-prod-xxxx --versioning-configuration Status=Enabled …`).
  Så kan et objekt, der slettes eller overskrives ved en fejl, hentes tilbage i 30 dage (reglen i trin 6).
- **GDPR:** med versionering er et slettet foto eller en slettet optagelse først helt væk, når den gamle version
  udløber (30 dage). Det svarer til opbevaringen af database-backups (`docs/PRODUKTIONSPLAN.md`, fase 4) og skal
  nævnes i privatlivspolitikken og fortegnelsen (art. 30).
- **Det vigtigste at tage backup af er databasen** (daglig `pg_dump`, krypteret, i Hetzner Storage Box i et andet
  datacenter). Bucketten indeholder kun fotos, som kan uploades igen, og optagelser, som alligevel slettes efter
  transskription. En kopi af bucketten til en anden location er derfor ikke nødvendig ved lancering.
- Test gendannelse én gang om måneden sammen med databasen. Hent fx et foto-objekt og en gammel version, og tjek, at de kan åbnes.

## 8. Kontrollér opsætningen

På serveren:

```bash
docker compose run --rm migrate npm run storage:check
```

(lokalt med en `.env`: `npm run storage:check`). Scriptet bruger appens egen konfiguration og:

1. skriver et lille testobjekt (`healthcheck/…`), læser det tilbage og sletter det igen,
2. tjekker, at bucketten er **privat** (anonym læsning skal give HTTP 403),
3. tjekker, at **CORS** tillader upload fra `APP_URL`.

Forventet resultat:

```
Lager: S3 · endpoint https://fsn1.your-objectstorage.com · region fsn1 · bucket abu-prod-xxxx · path-style · nøgle sat
OK       Skrev testobjektet healthcheck/storage-check-….txt (42 bytes).
OK       Læste testobjektet tilbage – indholdet er identisk.
OK       Bucketten er privat: anonym læsning afvises (HTTP 403).
OK       CORS tillader direkte upload (POST) fra https://app.abu.dk.
OK       Slettede testobjektet igen.

Lageret virker.
```

`FEJL` betyder, at noget skal rettes (forkert nøgle, bucket-navn, region eller en offentlig bucket). `ADVARSEL` ved
CORS betyder, at appen virker, men at manuel upload af optagelser fejler, indtil trin 5 er gjort.

Prøv derefter i appen:

- Upload et profilbillede under *Min profil*. Det skal vises på profilen og i kataloget under `/kom-i-gang`.
- Upload en kort optagelse på et afholdt testmøde.

## 9. Databehandleraftale (DPA) – husk

Hetzner er databehandler for optagelser (persondata, evt. følsomme) og rådgiverfotos. Indgå Hetzners
**databehandleraftale (AVV/DPA)** i Hetzner Console under kontoindstillingerne (*Data protection* /
*Auftragsverarbeitung*). Den accepteres online. Gem en PDF-kopi, og skriv Hetzner (Object Storage, location) ind i
fortegnelsen over behandlingsaktiviteter og privatlivspolitikken. Se også `docs/OPEN_ITEMS.md` (juridisk/GDPR).

## Kort tjekliste

- [ ] Projekt oprettet, bucket oprettet i `fsn1`/`nbg1`/`hel1` med **Private**
- [ ] S3-nøgler oprettet og gemt i adgangskodemanageren
- [ ] `.env`: `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- [ ] CORS-regel sat (kun `APP_URL`)
- [ ] Livscyklusregler sat, versionering slået til
- [ ] `npm run storage:check` giver «Lageret virker.»
- [ ] Profilbillede og testoptagelse virker i appen
- [ ] Databehandleraftale med Hetzner indgået
