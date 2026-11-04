# Robotarmrefactor — plan en uitvoering

## Goedgekeurd ontwerp

Eén armobject bewaart zes benoemde lokale hoeken in radialen. `robot_arm.js` bevat
de publieke functies en een leesbaar instellingenblok. `arm_view.js` ontvangt
alleen afmetingen en hoeken en behoudt het bestaande model, camera en lifecycle.
`inverse_kinematics.js` bevat de heupberekening en het afstand/hoogte-vlak met
invulfuncties voor de andere gewrichten. `manual.js` verbindt de bediening met de
arm en verstuurt de actuele armstand zonder de IK opnieuw te berekenen.

Publieke functies: `turnJoint`, `setAngles`, `getAngles`, `getServoAngles`,
`onChange`, `setActive`, `dispose`. Gewrichten: hip, shoulder, elbow, wrist,
palm, fingers. Servo-uitvoer blijft één integer snapshot met kanalen 0–5.
`pose.js`, `joint_config.js`, `arm_model.js` en de oude volledige solver verdwijnen.
Kalibratie en volledige IK blijven uitgeschakeld; de bestaande layout blijft.

## Uitvoering

- [x] Armtoestand, instellingen en validatie samenbrengen; servohoeken afleiden.
- [x] Model en renderer samenbrengen in de losse tekenlaag.
- [x] IK omzetten naar radialen en benoemde gewrichten.
- [x] Bediening omzetten; directe armwijzigingen niet overschrijven bij submit.
- [x] Bestaande testgevallen en documentatie migreren.
- [x] Frontendbuild en diffcontrole.
- [x] Onafhankelijke statische review; drie gevonden inconsistenties gecorrigeerd.

## Keuzes tijdens uitvoering

- De bestaande featurebranch en gedeelde IDE-checkout blijven in gebruik. Geen
  commit of worktreewisseling; bestaande firmwarewijzigingen en referentierepo
  blijven behouden.
- Tests worden aangepast maar niet uitgevoerd, overeenkomstig het expliciete
  verzoek. Ook de reviewer mag geen tests of browserchecks uitvoeren.
- `createRobotArm(canvas, settings)` heeft een optioneel tweede argument voor
  een eigen arm met eigen afmetingen/kalibratie, zonder apart configuratiebestand.
  Instellingen worden eenmaal gecontroleerd, gekopieerd en bevroren per arm.
- `solveIK(arm, target, handAngles)` heeft een optioneel derde argument zodat één
  formulierwijziging atomair wordt toegepast, inclusief palm en vingers. De
  normale tweeargumenten-aanroep behoudt de actuele handstand.
- Model-nullstanden zijn overal lokale radialen. De huidige offsets blijven
  behouden. De demo-grijper gebruikt een vaste halve draai rond zijn nullstand;
  aanpassingen van servo-offsets wijzigen de omzetting, niet de tekenlaag.
- Alleen floating-point-rekenfouten tot 1e-10 graden rond een servogrens worden
  geaccepteerd. Het integercommando moet altijd binnen de ingestelde grenzen vallen.

## Verificatie

Productiebuild: `cd web && npm run build` succesvol. De bestaande Vite-waarschuwing
over een chunk groter dan 500 kB blijft aanwezig. `git diff --check` schoon.

Onafhankelijke statische review door een aparte agent vond drie inconsistenties,
die daarna zijn gecorrigeerd:

1. Directe armwijzigingen synchroniseren handsliders ook tijdens ongeldige
   doelinvoer; afgewezen formulierwijzigingen synchroniseren ze niet terug.
2. Hand-sliders gebruiken gehele grenzen (`ceil(min)`, `floor(max)`) zodat hun
   stap van één graad consistent is met de API-commando's.
3. Het teruggegeven armobject is bevroren: instellingen en functies kunnen niet
   vervangen worden terwijl de opgeslagen instellingen in de arm gelijk blijven.

De bestaande 38 testgevallen zijn gemigreerd, inclusief checks voor absolute
rotatie, atomaire wijzigingen, kopieën, directe armwijzigingen en verstuurstatus.
Tests en browserchecks zijn bewust niet uitgevoerd; geen claim over slagen van
de tests of runtimegedrag in de browser. Backend en firmware zijn niet aangepast.
