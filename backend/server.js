import {createApp} from './app.js';

function portValue(value, fallback, name) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a port from 1 to 65535`);
  return port;
}
const port = portValue(process.env.PORT, 3000, 'PORT');
const app = createApp({host: process.env.ESP32_HOST, port: portValue(process.env.ESP32_PORT, 3333, 'ESP32_PORT')});
app.listen(port, () => console.log(`Robot arm: http://localhost:${port}`));
