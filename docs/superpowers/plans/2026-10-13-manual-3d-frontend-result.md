# Manual 3D frontend — resultaat

Afgerond op 14 oktober 2026. Codecommits: `8691f14`, `a962588`, `44d4a57`, `c2aad1a`.

Implementatie op branch `codex/manual-3d-frontend`. De bron-ingang is `web/index.html`; `web/static/index.html` is gegenereerde Vite-uitvoer.

## Geleverd

- Manual/Automatic-tabs; Automatic is een placeholder voor de latere camerastream.
- Zelfstandige Three.js-arm in `web/js/robot_arm.js`, met hiërarchisch model en vaste perspectiefcamera.
- XYZ/toolpitch-IK voor heup, schouder, elleboog en pols; aparte palm- en vingersliders.
- Servohoekweergave, expliciete invoerfouten, behoud van laatste geldige pose, WebGL-fallback en status bij verzenden.
- Eén frontendbatch naar `POST /api/arm/angles`; geen backendwijziging of automatische verzending.
- Vereenvoudigde donkere/turquoise widgetlayout, toetsenbordtabs en smalle schermindeling.

## Verificatie

Controller: frontend `npm test` 38/38; backend `npm test` 12/12; productiebuild geslaagd; diffcontrole schoon. Browser: echte WebGL-weergave op desktop en 390 px, IK/invoer/sliders, ongeldige doelen, tabs/toetsenbord en behoud van waarden gecontroleerd. Nagebootste batch-API in geïsoleerde browsercontext: juiste zes gehele hoeken, één request, pendingblokkering, acceptatie, fout en expliciete retry. WebGL-fallback gecontroleerd. Productiebuild laadt via bestaande Express-server. Geen hardware aangestuurd.

Onafhankelijke reviews per taak en van de volledige branch vonden geen blokkerende problemen. De oversla-link is hersteld; echte toetsenbordbediening in Manual en Automatic slaagt, met behoud van de gekozen tab. Een onafhankelijke gerichte herreview bevestigde de oplossing zonder nieuwe bevindingen.

Buildmelding: hoofd-JS 539,54 kB, gzip 137,20 kB, grotendeels Three.js. Drempel is niet verhoogd.

## Besluiten tijdens uitvoering

| Besluit | Reden | Gevolg als bijstelling nodig is |
| --- | --- | --- |
| Nieuwe lokale featurebranch in bestaande checkout | Werk direct zichtbaar in IDE; andere backendwerkzaamheden en gebruikerswijzigingen behouden | Werk lokaal herorganiseren |
| Goedgekeurde specificatie uitvoeren zonder nieuwe ontwerpronde | Gebruiker vroeg implementatie van het plan | Wijzigingen zijn via diff aanpasbaar |
| Gehele servohoeken na mapping, validatie vóór en na afronden | Aansluiting op bestaande backend/firmwaregrens | API- en mappingcontract aanpassen als transport anders wordt |
| HTML-bron naar web/index.html, build naar web/static | Vite en bestaande Express-staticpaden combineren | Entry/buildconfig samen aanpassen |
| Genormaliseerde demogeometrie en calibrated:false | Echte maten/montage nog ontbreken | Kalibratie invullen vóór hardwaregebruik |
| Rechtstreeks werken vanuit referentie/spec/productdocumenten | Impeccable-contextloader gaf permission denied | Ontwerpbesluiten later bijstellen indien context afwijkt |
| Extra gerichte Manual-controllertests | Kritieke validatie en verzendblokkering verdienen gedragsdekking | Klein extra testbestand onderhouden |
| Bundelwaarschuwing behouden; prestaties later meten | Geen aangetoond prestatieprobleem; Manual gebruikt Three.js direct | Mogelijk tragere eerste lading totdat gemeten en verbeterd |
| Featurebranch lokaal bewaren | Implementatie gevraagd; integratie/publicatie niet gevraagd | Later zelf mergen of PR maken |

## Voor hardwaregebruik

Zie `web/README.md`: meet geometrie, configureer grenzen/offsets/draairichting en initiële doelen; activeer kalibratie pas na controle. De aparte backendchat moet het batchendpoint implementeren. HTTP-acceptatie zegt niets over afgeronde beweging. De 3D-arm geeft geen positiefeedback of botsingscontrole.
