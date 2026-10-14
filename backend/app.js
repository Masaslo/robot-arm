import express from 'express';
import {fileURLToPath} from 'node:url';

export function createApp({sendTarget}) {
  const app = express();
  app.use(express.json({limit: '1kb'}));
  app.post('/api/servo', async (req, res) => {
    const {servo, angle} = req.body ?? {};
    if (!Number.isInteger(servo) || servo < 0 || servo > 15 ||
        !Number.isInteger(angle) || angle < 0 || angle > 180) {
      return res.status(400).json({error: 'Gebruik een geheel kanaal van 0–15 en een gehele hoek van 0–180.'});
    }
    try {
      await sendTarget(servo, angle);
      res.json({message: 'Doel geaccepteerd. De beweging kan nog bezig zijn.'});
    } catch (error) {
      res.status(error.status ?? 503).json({error: error.message ?? 'Verbinding met de ESP32 mislukt.'});
    }
  });
  app.post('/api/arm/angles', async (req, res) => {
    const angles = req.body?.anglesDeg;
    const channels = [0, 1, 2, 3, 4, 5];
    // Validate the complete input before sending anything to the firmware.
    if (!angles || typeof angles !== 'object' || Array.isArray(angles) ||
        Object.keys(angles).length !== channels.length || !channels.every(channel =>
          Object.hasOwn(angles, channel) && Number.isInteger(angles[channel]) &&
          angles[channel] >= 0 && angles[channel] <= 180)) {
      return res.status(400).json({error: 'Geef precies zes kanalen (0–5) met gehele hoeken van 0–180° op.'});
    }
    try {
      // Each target uses the shared queue; stop at the first rejected target.
      for (const channel of channels) {
        await sendTarget(channel, angles[channel]);
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
