import express from 'express';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

// One connection per command: a late acknowledgement cannot satisfy another request.
function sendTarget({host, port, timeoutMs}, servo, angle) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (status, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (status) reject({status, message}); else resolve();
    };
    const deadline = setTimeout(() => finish(504, 'Geen bevestiging binnen de tijdslimiet.'), timeoutMs);
    socket.on('error', () => finish(503, 'Verbinding met de ESP32 mislukt.'));
    socket.on('end', () => finish(502, 'Onvolledige bevestiging van de ESP32.'));
    socket.on('close', () => finish(502, 'Verbinding gesloten zonder bevestiging.'));
    socket.on('data', chunk => {
      // OK\n and ERR\n are the only permitted frames; bound storage before concatenation.
      if (buffer.length + chunk.length > 4) return finish(502, 'Ongeldige bevestiging van de ESP32.');
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      if (buffer.equals(Buffer.from('OK\n'))) finish(0);
      else finish(502, 'De ESP32 heeft het doel geweigerd of ongeldig bevestigd.');
    });
    socket.connect(port, host, () => socket.write(`${servo}:${angle}\n`));
  });
}

export function createApp({host, port = 3333, timeoutMs = 2000} = {}) {
  if (typeof host !== 'string' || !host.trim()) throw new Error('ESP32_HOST is required');
  const app = express();
  app.use(express.json({limit: '1kb'}));
  app.post('/api/servo', async (req, res) => {
    const {servo, angle} = req.body ?? {};
    if (!Number.isInteger(servo) || servo < 0 || servo > 15 ||
        !Number.isInteger(angle) || angle < 0 || angle > 180) {
      return res.status(400).json({error: 'Gebruik een geheel kanaal van 0–15 en een gehele hoek van 0–180.'});
    }
    try {
      await sendTarget({host, port, timeoutMs}, servo, angle);
      res.json({message: 'Doel geaccepteerd. De beweging kan nog bezig zijn.'});
    } catch (error) {
      res.status(error.status ?? 503).json({error: error.message ?? 'Verbinding met de ESP32 mislukt.'});
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
