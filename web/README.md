# Robot Arm webclient

Vanilla JavaScript, Vite en lokaal geïnstalleerde Three.js. Manual gebruikt CCD inverse kinematics om de arm-tip naar een XYZ-doel te bewegen. Automatic blijft een placeholder voor de camerastream.

## Camerabeeld

Een camera stuurt een ruwe JPEG naar `POST /api/camera/frame` met `Content-Type: image/jpeg` (maximaal 2 MB). Bijvoorbeeld: `curl -X POST -H 'Content-Type: image/jpeg' --data-binary @foto.jpg http://localhost:3000/api/camera/frame`. De backend bewaart alleen het laatste frame in geheugen; na een herstart is er geen frame. `GET /api/camera/frame` geeft dit frame terug, of 404 als het ontbreekt. De widget in Manual haalt elke seconde het nieuwste beeld op en bewaart het laatste zichtbare beeld bij een verbindingsfout.

## De arm bedienen

De bestaande pagina maakt **één** arm aan in `mountManual()`. In `app.js` kun je deze bedienen via `manual.arm`:

```js
manual.arm.turnJoint('hip', Math.PI / 4);       // 45° lokale heuprotatie
manual.arm.turnJoint('shoulder', Math.PI / 6); // 30° boven horizontaal
manual.arm.turnJoint('elbow', -Math.PI / 3);   // -60° ten opzichte van de bovenarm
```

Voor een eigen canvas maak je een arm met `createRobotArm(canvas)` uit `js/robot_arm.js`. Zonder canvas werkt `createRobotArm()` ook voor alleen de hoeken; de preview is dan niet beschikbaar en verzending blijft geblokkeerd.

| Functie | Betekenis |
| --- | --- |
| `arm.turnJoint(name, radians)` | Zet één absolute lokale hoek; telt geen rotatie op |
| `arm.setAngles({ hip, shoulder, ... })` | Zet meerdere hoeken tegelijk; alles wordt eerst gecontroleerd |
| `arm.getAngles()` | Kopie van alle zes lokale hoeken in radialen |
| `arm.getServoAngles()` | Zes afgeleide gehele servohoeken in graden voor de API |
| `arm.onChange(callback)` | Callback bij veranderde hoeken of previewstatus; geeft een afmeldfunctie terug |
| `arm.setActive(boolean)` | Pauzeert/hervat tekenen bij tabwissels |
| `arm.dispose()` | Ruimt listeners en grafische middelen op; latere wijzigingen worden afgewezen |

Gebruik de namen `hip`, `shoulder`, `elbow`, `wrist`, `palm` en `fingers`. Onbekende namen, NaN/Infinity en overschrijdingen van de servogrenzen geven een leesbare fout. Bij een fout verandert geen enkel gewricht. De arm bewaart uitsluitend radialen; servohoeken worden telkens afgeleid. De callback krijgt een kopie van die radialen. De instellingen worden per arm gekopieerd en zijn daarna alleen leesbaar.

Heup draait rond Z. Schouder draait ten opzichte van horizontaal; elleboog en pols zijn relatieve buighoeken. Palm draait rond de gereedschapsas. Vingers gebruiken een hoek rond hun servonulstand: met de demo-offset van 90° is `-Math.PI / 2` gesloten, `0` halfopen en `Math.PI / 2` open. De genormaliseerde grijper is een visueel voorbeeld, geen CAD-model.

## Toetsenbordbediening

Onder de doelpositie staat de **Toetsenbord**-widget, gebaseerd op `ControlWidget` en `useManualDrive` uit `h-robo-twin-rsl`. Klik op **Bediening inschakelen** en houd de toetsen ingedrukt:

| Toets | Verplaatsing van het XYZ-doel |
| --- | --- |
| W / S | Vooruit / achteruit: X verhogen / verlagen |
| A / D | Links / rechts: Y verhogen / verlagen |
| Space | Omhoog: Z verhogen |
| Shift (links of rechts) | Omlaag: Z verlagen |
| Escape | Bediening uitschakelen |

De schermknoppen ondersteunen ook vasthouden met muis of touch en lichten op tijdens bewegen. Met Tab gefocuste knoppen werken met Space/Enter. De snelheidsregelaar loopt van 10% tot 100%; 100% is 0,5 modeleenheid per seconde. Diagonaal bewegen gaat even snel als langs één as. Kleine XYZ-stappen worden met maximaal vijf decimalen opgeslagen; de velden accepteren die zonder een vaste stapgrootte.

De widget werkt zolang de focus erin blijft. Wegklikken, Tab naar een andere widget, vensterfocus verliezen, de pagina verbergen of Automatic openen schakelt de bediening uit. Tijdens typen in invoervelden worden bewegingstoetsen niet onderschept. Tijdens verzenden of bij een onbeschikbare preview/ongeldige invoer is de widget geblokkeerd.

Elke stap gebruikt de bestaande CCD-solver en werkt de XYZ-velden, arm en servo-uitlezing samen bij. Een onbereikbare stap houdt de vorige stand en coördinaten; laat de toets los en kies een andere richting. **Toetsenbordbediening verstuurt niets naar de firmware.** Gebruik daarvoor bewust **Send Angles**; deze verstuurt de getoonde servohoeken.

## Inverse kinematics met CCD

De aanpak volgt **Workshop - Motion**, slides 15–16, en de daarin gelinkte [uitleg van CCD door Ryan Juckett](https://www.ryanjuckett.com/cyclic-coordinate-descent-in-2d/). De code in `js/inverse_kinematics.js` gebruikt gewone functies en `let`-variabelen voor de vier gewrichtshoeken.

1. `solveHip(x, y)` draait de heup naar X/Y met `atan2`, in radialen.
2. `projectToArmPlane()` maakt een verticaal vlak: `distance = hypot(x, y)` en `height = z - baseHeight`. In dat vlak gebruiken de rekenfuncties `{ x: distance, y: height }`.
3. `solveWrist()` draait de lijn **pols → arm-tip** naar de lijn **pols → doel**.
4. `solveElbow()` doet hetzelfde voor **elleboog → arm-tip** en **elleboog → doel**.
5. `solveShoulder()` doet hetzelfde voor **schouder → arm-tip** en **schouder → doel**.
6. De cyclus pols → elleboog → schouder wordt herhaald tot de tip dichtbij genoeg is.

Na elke draaiing worden alle posities opnieuw berekend. Het eindpunt is steeds de **tip na de volledige tool-lengte**, ook bij het oplossen van elleboog en schouder. Een draaiing wordt tijdens het rekenen begrensd aan de lokale servohoeken; de volgende gewrichten kunnen de resterende afwijking verder verkleinen.

### Kleine hulpfuncties

| Functie | Betekenis |
| --- | --- |
| `calculateAngleToPoint(from, to)` | Richting tussen twee 2D-punten, met `atan2` |
| `calculateDistance(from, to)` | Afstand tussen twee 2D-punten |
| `calculateNextPoint(start, length, angle)` | Positie na een link met deze lengte en hoek |
| `getArmPoints(dimensions)` | Schouder, elleboog, pols en tip bij de huidige IK-hoeken |
| `calculateRotation(jointPoint, endPoint, targetPoint)` | Verschil tussen de richting naar de tip en naar het doel |
| `limitAngle(angle, joint)` | Lokale hoek begrenzen met servo-offset, richting en grenzen |

Bijvoorbeeld, de schouderstap is:

```js
export function solveShoulder(targetPoint, dimensions, joint) {
  const points = getArmPoints(dimensions);
  const rotation = calculateRotation(points.shoulder, points.end, targetPoint);
  shoulder = limitAngle(shoulder + rotation, joint);
}
```

De vier joint-solvers veranderen hun `let`-variabele en hebben geen returnwaarde. Helpers geven hun berekening wel terug.

### Stoppen, grenzen en beginstand

`solveIK(arm, { x, y, z })` begint met de actuele hoeken uit de arm. Een volledig rechte arm krijgt voor een binnenliggend doel eerst een gebogen beginstand, zodat CCD niet op die rechte lijn blijft vastzitten. Bij een doel aan de buitenrand begint de arm juist uitgestrekt in de doelrichting. De heup wordt afzonderlijk op X/Y gericht.

De nauwkeurigheid is **0,1% van de totale linklengte**. Na maximaal **300 cycli** stopt het rekenen. Een doel buiten het maximale bereik of een doel waarvoor geen oplossing wordt gevonden geeft een fout; de vorige 3D-stand blijft behouden. CCD kan door gewrichtsgrenzen of een ongunstige beginstand vastlopen, dus die fout betekent niet altijd dat een doel fysiek onmogelijk is.

Een nulpuntvector wordt bij het draaien overgeslagen. Daardoor kan een tool met lengte nul ook via elleboog en schouder bewegen. De totale tool-lengte zit in de positieberekening; er wordt geen gewenste toolpitch opgelegd. Het ongebruikte Toolpitch-veld is verwijderd.

`IK_COMPLETE` is nu `true` voor deze positie-IK. `calibrated` blijft standaard `false` en bepaalt het label Demomodel/Gekalibreerd; het blokkeert de verzendknop niet.

Een doelveld past de CCD-berekening toe. Een Palm/Vingers-slider wijzigt alleen dat gewricht. Readouts en sliders volgen de actuele arm. **Send Angles rekent de IK niet opnieuw uit**: de knop verstuurt een snapshot van `arm.getServoAngles()`. Een optioneel derde argument `{ palm, fingers }` bij `solveIK()` laat het formulier ook de hand in dezelfde wijziging toepassen.

## Afmetingen en servo-instellingen

Alle instellingen staan bovenaan `js/robot_arm.js` in `ARM_SETTINGS`, zonder apart configuratiebestand:

- `dimensions`: `baseHeight`, `upperArm`, `forearm`, `tool`; huidige waarden zijn genormaliseerde demomaten. Gebruik voor alle lengtes en X/Y/Z dezelfde eenheid. X is vooruit, Y zijwaarts en Z omhoog.
- `joints`: per naam één `servoId`, `label`, `offset`, `direction`, `min` en `max`. Servo-ID’s zijn Heup 0, Schouder 1, Elleboog 2, Pols 3, Palm 4 en Vingers 5. De firmware vertaalt deze IDs met zijn servo-configuratie naar fysieke PCA9685-kanalen.
- Voor **alle zes** gewrichten geldt `servoDegrees = offset + direction × degrees(localRadians)`. Dit geldt ook voor Palm en Vingers; hun sliders tonen fysieke graden en zetten die bij invoer terug om naar lokale radialen.
- Modelhoeken houden hun precisie. Commando's worden afgerond naar gehele graden; zowel de ongeronde waarde als het afgeronde commando moet binnen de grenzen vallen. Alleen rekenkundige afrondfouten tot `1e-10` graden aan een grens worden geaccepteerd.
- `calibrated` blijft `false` totdat maten, montage, richtingen en grenzen op de echte arm zijn gecontroleerd. Een arm kopieert de instellingen bij aanmaken; na bronwijzigingen herlaad je de pagina en bouw je opnieuw voor Express.

Versturen vereist geldige invoer, een beschikbare preview en `IK_COMPLETE: true`. Send Angles verstuurt de actuele servohoeken met de ingestelde offsets, richtingen en grenzen, ook wanneer `calibrated: false` is. Dit kenmerk beschrijft de kalibratiestatus; het is geen verzendblokkade. Invoerfouten behouden de vorige armstand. WebGL-uitval toont een fallback en blokkeert ook programmatisch versturen. Een lopende aanvraag blokkeert de bediening en dubbele aanvragen.

## Bestanden

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `js/robot_arm.js` | Publieke armfuncties, instellingen en actuele hoeken |
| `js/arm_view.js` | Modelbouw, camera, verlichting, tekenen en opruimen |
| `js/inverse_kinematics.js` | Jouw IK-berekeningen en het 2D-vlak |
| `js/manual.js` | Formulier, sliders, endpointverplaatsing, readouts en versturen |
| `js/keyboard_control.js` | Toetsenbordwidget, schermknoppen en focus/stop-afhandeling |
| `js/app.js` | Manual/Automatic-tabs en paginalifecycle |
| `js/api.js` | Batchverzoek, HTTP-fouten en timeout |
| `index.html`, `style/` | Layout en stijlen |
| `static/` | Gegenereerde productiebuild |

`pose.js`, `joint_config.js` en het oude `arm_model.js` zijn verwijderd. Er is één actieve solver, één armtoestand en één instellingenblok.

## Starten en bouwen

Gebruik Node.js **22.12.0 of nieuwer**:

```sh
cd web
npm ci
npm run dev
```

Open de getoonde Vite-URL (standaard `http://127.0.0.1:5173`). De `/api`-proxy gaat naar `http://localhost:3000`; start de backend afzonderlijk volgens de root-README.

```sh
npm run build
npm run preview
```

**Bouw vóór het starten van Express.** De bestaande server serveert `web/static`, inclusief `/assets`. Bewerk de bronbestanden; `static/index.html` is gegenereerd en wordt bijgehouden, assets worden genegeerd. Een wijziging vereist opnieuw bouwen voor Express.

De bestaande frontendtests zijn aangepast aan de benoemde gewrichten en radialen. Je kunt ze op verzoek uitvoeren met `npm test`; bij deze refactor worden ze niet automatisch uitgevoerd. De HTTP-tests vereisen geen hardware.

## Batch-API

De frontend verwacht precies **één** same-origin verzoek per expliciete Send Angles-actie:

```http
POST /api/arm/angles
Content-Type: application/json

{"anglesDeg":{"0":90,"1":90,"2":90,"3":90,"4":32,"5":122}}
```

De sleutels zijn exact `"0"` tot en met `"5"`; iedere waarde is een JSON-getal, geheel en binnen 0–180°, en is gekoppeld aan die servo-ID. De firmware bepaalt welk fysiek PCA9685-kanaal erbij hoort. Dit voorbeeld gebruikt een gebogen pose en is geen veilig hardwarecommando. De frontend voert **geen** zes losse `/api/servo`-aanvragen uit en heeft geen fallback naar dat endpoint.

Een 2xx-response betekent acceptatie van het doel; de beweging kan nog bezig zijn. JSON met `{"message":"..."}` of een lege 204-response is toegestaan. De UI meldt backendacceptatie en claimt geen voltooid bewegen. Voor fouten verwacht de client een niet-2xx-status met `{"error":"leesbare melding"}` (of `message`); een lege, HTML- of anderszins ongeldige JSON-body krijgt een HTTP-foutmelding. De client kapt na 15 seconden af, toont netwerk/timeoutfouten en probeert niet automatisch opnieuw. Een retry is een nieuwe expliciete actie; een verloren antwoord kan na acceptatie optreden.

**Dit endpoint is geïmplementeerd in `backend/app.js`.** De backend controleert eerst alle zes servo-ID’s en hoeken. Daarna stuurt hij ze op volgorde 0–5 over de persistente TCP-verbinding die de ESP32 met de backend opent: één `servo-ID:hoek\n`-commando tegelijk, met precies één `OK\n`- of `ERR\n`-bevestiging per commando volgens het firmwareprotocol. Beide HTTP-endpoints delen dezelfde wachtrij; er wacht maximaal één commando op bevestiging. Pas na zes bevestigingen volgt HTTP 200. Bij een fout stopt het versturen; eerdere doelen kunnen dan al geaccepteerd zijn en bewegen. Er is geen automatische retry of rollback en de zes doelen worden niet gelijktijdig toegepast. Bij verbreken van de verbinding mislukken ook wachtende commando's; na opnieuw verbinden worden ze niet automatisch herhaald. Zonder verbonden ESP32 geeft de backend HTTP 503. `POST /api/servo` blijft beschikbaar. Omdat ACK-frames geen opdracht-ID bevatten, kan een vertraagde dubbele ACK na het volgende commando niet van diens antwoord worden onderscheiden; correcte werking vereist daarom dat firmware precies één ACK per commando stuurt. Frontendkalibratie vervangt geen backend- en firmwarelimieten.
