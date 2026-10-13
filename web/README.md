# Robot Arm webclient

Vanilla JavaScript, Vite en lokaal geïnstalleerde Three.js. De Manual-tab berekent vier gewrichten uit X/Y/Z en toolpitch, toont de pose in 3D en biedt twee afzonderlijke sliders voor Palm en Vingers. Automatic is een placeholder voor een latere camerastream.

## Starten en bouwen

Gebruik Node.js **22.12.0 of nieuwer**:

```sh
cd web
npm ci
npm run dev
```

Open de getoonde Vite-URL (standaard `http://127.0.0.1:5173`). Vite stuurt `/api` ongewijzigd door naar `http://localhost:3000`; de backend start afzonderlijk volgens de root-README. De democonfiguratie verstuurt niets.

```sh
npm test
npm run build
npm run preview
```

`npm test` gebruikt Node's ingebouwde test runner voor de kinematica, kalibratie, HTTP-grens, modeltransformaties en invoer/verstuurstatus. De tests gebruiken geen hardware. `npm run preview` bekijkt alleen de productiebuild; de ontwikkelproxy hoort bij `npm run dev`.

**Bouw vóór het starten van Express:** voer `npm run build` uit in `web`, start daarna `npm start` in `backend`, en open `http://localhost:3000`. De bestaande Express-server serveert de build uit `web/static`, inclusief `/assets`. Een wijziging aan broncode of kalibratie vereist een nieuwe build voor Express.

## Bronbestanden en uitvoer

| Pad | Doel |
| --- | --- |
| `web/index.html` | Vite-ingang en toegankelijke bediening |
| `web/js/app.js`, `manual.js` | Tabs, formulier, validatie en expliciet versturen |
| `web/js/joint_config.js` | Geometrie, kanaaltoewijzing, limieten en kalibratie |
| `web/js/pose.js`, `inverse_kinematics.js` | IK en omzetting naar servohoeken |
| `web/js/robot_arm.js`, `arm_model.js` | Echte Three.js-weergave en model |
| `web/js/api.js` | Eén batchverzoek, foutafhandeling en timeout |
| `web/style/` | Bron-CSS |
| `web/static/index.html` | Gegenereerde, bijgehouden build-ingang |
| `web/static/assets/` | Gegenereerde, genegeerde JS/CSS-assets; lokaal bouwen |

De Vite-root is `web`; `static` is alleen de uitvoermap. Er is geen public-map. Bewerk de bronbestanden en bouw opnieuw; bewerk `static/index.html` niet handmatig.

## Geometrie en kalibratie

`ARM_CONFIG` in `js/joint_config.js` begint bewust met `calibrated: false`. De voorbeeldmaten zijn **genormaliseerde modeleenheden**, geen gemeten millimeters of centimeters. Een geldig doel geeft wel een 3D-voorbeeld, maar Send Angles blijft geblokkeerd. De submit-handler controleert dit opnieuw, ook wanneer het formulier programmatisch wordt ingediend.

Meet en configureer de echte arm vóór gebruik:

1. Vul `geometry.baseHeight`, `upperArm`, `forearm` en `tool` in. `baseHeight` is de hoogte van het schouderdraaipunt boven de grond; de drie andere maten lopen tussen de draaipunten en van pols naar gereedschapspunt. Gebruik voor alle lengtes en X/Y/Z dezelfde eenheid. `upperArm` en `forearm` moeten positief zijn; `baseHeight` en `tool` mogen nul zijn.
2. Controleer de assen: X voorwaarts, Y zijwaarts, Z omhoog. Toolpitch is in graden: 0° is horizontaal naar buiten, positief draait het gereedschap omhoog. De IK kiest de elleboog-omlaagtak. De genormaliseerde demogrip is een visueel voorbeeld en geen CAD- of botsingsmodel.
3. Koppel precies zes unieke `joints[].id` aan de kanalen **0–5**. Configureer per servo een herkenbare `name`, `minDeg`/`maxDeg` binnen 0–180°, een eindige `offsetDeg` en `direction` van `1` of `-1`.
4. Voor kanalen 0–3 is `servoDeg = offsetDeg + direction × modelAngleDeg`. Modelhoeken zijn: heup/yaw, schouder t.o.v. horizontaal, relatieve elleboog, relatieve pols. De pols houdt de gevraagde toolpitch aan. Controleer zowel nulstand als draairichting tegen de echte montage.
5. Palm (4) en Vingers (5) zijn directe fysieke servohoeken uit de sliders; daarvoor worden offset en direction niet opnieuw toegepast. Hun sliders gebruiken de ingestelde min/max-limieten. Alle zes commando's worden naar gehele graden afgerond; de grenscontrole gebeurt zowel vóór als na afronden.
6. Zet `calibrated: true` pas nadat de geometrie, montage en grenzen gecontroleerd zijn. Zorg dat de batch-API hieronder beschikbaar is en bouw opnieuw. Een true-vlag met ongeldige configuratie of een onbereikbaar doel blijft geblokkeerd.

Pas bij echte lengteeenheden ook de tekst `model-units` in `index.html` aan naar de gekozen eenheid. Hoekwaarden rechts zijn berekende servo-commando's, geen gemeten posities. Een leeg/ongeldig doel behoudt de laatste geldige 3D-pose en servohoekwaarden met een expliciet label; het huidige doel wordt niet verstuurd. De hoofdgewrichten hebben geen handmatige override. WebGL-fouten blokkeren versturen en tonen een tekstmelding.

## Batch-API voor de backendimplementatie

De frontend verwacht precies **één** same-origin verzoek per expliciete Send Angles-actie:

```http
POST /api/arm/angles
Content-Type: application/json

{"anglesDeg":{"0":90,"1":90,"2":90,"3":90,"4":32,"5":122}}
```

De sleutels zijn exact `"0"` tot en met `"5"`; iedere waarde is een JSON-getal, geheel en binnen 0–180°, en is al naar de fysieke servo gemapt. Dit voorbeeld gebruikt een gebogen pose en is geen veilig hardwarecommando. De frontend voert **geen** zes losse `/api/servo`-aanvragen uit en heeft geen fallback naar dat endpoint.

Een 2xx-response betekent acceptatie van het doel; de beweging kan nog bezig zijn. JSON met `{"message":"..."}` of een lege 204-response is toegestaan. De UI meldt backendacceptatie en claimt geen voltooid bewegen. Voor fouten verwacht de client een niet-2xx-status met `{"error":"leesbare melding"}` (of `message`); een lege, HTML- of anderszins ongeldige JSON-body krijgt een HTTP-foutmelding. De client kapt na 15 seconden af, toont netwerk/timeoutfouten en probeert niet automatisch opnieuw. Een retry is een nieuwe expliciete actie; een verloren antwoord kan na acceptatie optreden.

**Dit endpoint is nog niet geïmplementeerd in de bestaande backend.** De backendchat moet gezamenlijke validatie van de zes targets, firmwaretransport en bevestigingsbetekenis implementeren. Deze frontendwijziging verandert het bestaande `POST /api/servo`-contract of de firmware niet. Frontendkalibratie vervangt geen backend- en firmwarelimieten.
