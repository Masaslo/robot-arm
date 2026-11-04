import express from 'express';
import {fileURLToPath} from 'node:url';

export function createApp({sendTarget}) {
  const app = express();
  app.use(express.json({limit: '1kb'}));
  app.post('/api/servo', async (req, res) => {
    const {servoId, angle} = req.body ?? {};
    if (!Number.isInteger(servoId) || servoId < 0 || servoId > 5 ||
        !Number.isInteger(angle) || angle < 0 || angle > 180) {
      return res.status(400).json({error: 'Gebruik een servo-ID van 0–5 en een gehele hoek van 0–180.'});
    }
    try {
      await sendTarget(servoId, angle);
      res.json({message: 'Doel geaccepteerd. De beweging kan nog bezig zijn.'});
    } catch (error) {
      res.status(error.status ?? 503).json({error: error.message ?? 'Verbinding met de ESP32 mislukt.'});
    }
  });
  app.post('/api/arm/angles', async (req, res) => {
    const angles = req.body?.anglesDeg;
    const servoIds = [0, 1, 2, 3, 4, 5];
    // Validate the complete input before sending anything to the firmware.
    if (!angles || typeof angles !== 'object' || Array.isArray(angles) ||
        Object.keys(angles).length !== servoIds.length || !servoIds.every(servoId =>
          Object.hasOwn(angles, servoId) && Number.isInteger(angles[servoId]) &&
          angles[servoId] >= 0 && angles[servoId] <= 180)) {
      return res.status(400).json({error: 'Geef precies zes servo-ID’s (0–5) met gehele hoeken van 0–180° op.'});
    }
    try {
      // Each target uses the shared queue; stop at the first rejected target.
      for (const servoId of servoIds) {
        await sendTarget(servoId, angles[servoId]);
      }
      res.json({message: 'Alle zes doelen geaccepteerd. De beweging kan nog bezig zijn.'});
    } catch (error) {
      res.status(error.status ?? 503).json({error:
        `${error.message ?? 'Verbinding met de ESP32 mislukt.'} Eerder verstuurde servo's kunnen al bewegen.`});
    }
  });
  const web = fileURLToPath(new URL('../web/', import.meta.url));
  app.use('/js', express.static(`${web}/js`));
  app.use('/style', express.static(`${web}/style`));
  app.use(express.static(`${web}/static`));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(400).json({error: 'Ongeldige JSON-invoer.'});
    }
    next(error);
  });
  return app;
}
