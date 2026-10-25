# Hvor er verktøyet?

Mobilvennlig app (PWA) for å finne, flytte og låne ut verktøy. Alt kjører i nettleseren, uten egen server og uten byggesteg.

## Starte appen

Appen er bare statiske filer. Kameraet (QR-skanning) og installasjon på hjemskjermen krever **https**, så den må ligge på en webadresse:

**Enklest (gratis, 2 minutter):** Gå til https://app.netlify.com/drop, logg inn og dra hele mappen `hvor-er-verktoyet` inn i vinduet. Du får en https-adresse. Åpne den på mobilen og velg «Legg til på hjemskjermen» (iPhone: Del-knappen; Android: menyen ⋮ → «Installer app»).

Alternativer: GitHub Pages, eller en hvilken som helst webserver.

**Prøve lokalt på PC:** `python3 -m http.server 8080` i mappen, og åpne http://localhost:8080. (Kamera fungerer på localhost, men ikke fra mobilen mot PC-en uten https.)

## Oppsett som trengs

- **Bildetolking (valgfritt):** Krever en API-nøkkel fra Anthropic (console.anthropic.com → API Keys) og nett. Lim den inn under Mer → Bildetolking. Nøkkelen lagres bare på enheten og sendes bare til api.anthropic.com. Hvert bilde koster litt. Uten nøkkel kan du ta bilde og registrere manuelt.
- **Ingenting annet.** Ingen konto, ingen database å sette opp.

## Lagring

- Alt lagres i nettleseren på enheten (IndexedDB), også bilder og kvitteringer. Det står tydelig i appen at data ikke er synkronisert.
- Ta sikkerhetskopi under Mer. Kopien inneholder alt, inkludert bilder, historikk og de faste QR-ID-ene. Gjenoppretting gir identiske ID-er, så trykte etiketter fortsetter å virke.
- Demomodus bruker en egen database og blandes aldri med dine data.

## Begrensninger

- Ingen synkronisering mellom enheter. Bruker du både mobil og nettbrett, blir det to separate registre.
- Plassering er alltid «sist registrert/bekreftet». Ingen GPS eller automatisk sporing.
- Påminnelser om utlån vises i appen (og som varsel når appen åpnes, hvis du slår det på), og du kan legge returdato i kalenderen. Appen kan ikke sende varsler når den er lukket.
- QR-kodene inneholder `HVV:<ID>`. Skannes de med telefonens vanlige kamera, vises bare teksten. Bruk «Skann» i appen.
- Sletter du nettleserdata for nettstedet, forsvinner registeret. Ta sikkerhetskopi.

## Tester

`node tests/test.cjs` (med appen servert på http://localhost:8765, Playwright installert) kjører 48 ende-til-ende-tester: kasseflytting med innhold, angre, utlån/retur, utilgjengelighet, kontroll, QR-koding/-tolking, PDF-etiketter, sikkerhetskopi/gjenoppretting, simulert bildetolking, demomodus og bruk uten nett.

## Filer

- `index.html`, `css/app.css`, `js/*.js` – appen
- `sw.js`, `manifest.webmanifest`, `icons/` – offline og installasjon
- `vendor/` – qrcode-generator (QR), jsQR (skanning), jsPDF (etiketter), Anthropic SDK (bildetolking)
