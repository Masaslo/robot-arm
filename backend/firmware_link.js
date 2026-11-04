import net from 'node:net';

function linkError(status, message) {
  return Object.assign(new Error(message), {status});
}

const unavailable = () => linkError(503, 'Verbinding met de ESP32 mislukt.');
const ok = Buffer.from('OK\n');
const err = Buffer.from('ERR\n');

export function createFirmwareLink({ackTimeoutMs = 2000} = {}) {
  let active = null;
  const queue = [];

  function finish(connection, error) {
    const command = connection.pending;
    if (!command) return;
    connection.pending = null;
    clearTimeout(command.deadline);
    if (error) command.reject(error); else command.resolve();
  }

  function disconnect(connection, error = unavailable()) {
    // Events from a replaced socket must never affect its replacement.
    if (active !== connection) return;
    active = null;
    finish(connection, error);
    for (const command of queue.splice(0)) command.reject(unavailable());
    connection.socket.destroy();
  }

  function pump() {
    const connection = active;
    if (!connection || connection.pending || queue.length === 0) return;
    const command = queue.shift();
    connection.pending = command;
    connection.buffer = Buffer.alloc(0);
    connection.socket.write(`${command.channel}:${command.angle}\n`, error => {
      if (active !== connection || connection.pending !== command) return;
      if (error) return disconnect(connection);
      // Queueing time is excluded: the deadline begins after the write completes.
      command.deadline = setTimeout(() => {
        disconnect(connection, linkError(504, 'Geen bevestiging binnen de tijdslimiet.'));
      }, ackTimeoutMs);
    });
  }

  const server = net.createServer(socket => {
    if (active) disconnect(active);
    const connection = {socket, pending: null, buffer: Buffer.alloc(0)};
    active = connection;
    socket.on('error', () => disconnect(connection));
    socket.on('end', () => disconnect(connection));
    socket.on('close', () => disconnect(connection));
    socket.on('data', chunk => {
      if (active !== connection) return;
      // Only a single exact acknowledgement is allowed for the outstanding command.
      if (!connection.pending || connection.buffer.length + chunk.length > 4) {
        return disconnect(connection, linkError(502, 'Ongeldige bevestiging van de ESP32.'));
      }
      connection.buffer = Buffer.concat([connection.buffer, chunk]);
      const buffer = connection.buffer;
      if (buffer.equals(ok) || buffer.equals(err)) {
        finish(connection, buffer.equals(err)
          ? linkError(502, 'De ESP32 heeft het doel geweigerd of ongeldig bevestigd.')
          : undefined);
        pump();
      } else if (!ok.subarray(0, buffer.length).equals(buffer) &&
                 !err.subarray(0, buffer.length).equals(buffer)) {
        disconnect(connection, linkError(502, 'De ESP32 heeft het doel geweigerd of ongeldig bevestigd.'));
      }
    });
  });

  function sendTarget(channel, angle) {
    if (!active || active.socket.destroyed || !active.socket.writable) {
      return Promise.reject(unavailable());
    }
    return new Promise((resolve, reject) => {
      queue.push({channel, angle, resolve, reject});
      pump();
    });
  }

  return {server, sendTarget};
}
