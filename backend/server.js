import {createServer} from 'node:http';
import {createApp} from './app.js';
import {createFirmwareLink} from './firmware_link.js';

function portValue(value, fallback, name) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a port from 1 to 65535`);
  return port;
}
const port = portValue(process.env.PORT, 3000, 'PORT');
const firmwarePort = portValue(process.env.FIRMWARE_PORT, 3333, 'FIRMWARE_PORT');
const {server: firmwareServer, sendTarget} = createFirmwareLink();
const httpServer = createServer(createApp({sendTarget}));

function failStartup(listener, error) {
  console.error(`Cannot start ${listener} listener: ${error.message}`);
  process.exit(1);
}
firmwareServer.on('error', error => failStartup(`firmware TCP on 0.0.0.0:${firmwarePort}`, error));
httpServer.on('error', error => failStartup(`HTTP on port ${port}`, error));
firmwareServer.listen(firmwarePort, '0.0.0.0', () => {
  console.log(`Firmware TCP: 0.0.0.0:${firmwarePort}`);
  httpServer.listen(port, () => console.log(`Robot arm: http://localhost:${port}`));
});
