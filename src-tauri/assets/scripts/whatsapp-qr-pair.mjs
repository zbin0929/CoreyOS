#!/usr/bin/env node
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import path from 'path';
import { mkdirSync } from 'fs';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const SESSION_DIR = getArg('session', path.join(process.env.HOME || '~', '.hermes', 'whatsapp', 'session'));
mkdirSync(SESSION_DIR, { recursive: true });

const logger = pino({ level: 'silent' });

function output(event) {
  process.stderr.write(JSON.stringify(event) + '\n');
}

async function run() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['CoreyOS', 'Chrome', '120.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      output({ type: 'qr', data: qr });
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        output({ type: 'error', message: 'Logged out' });
        process.exit(1);
      } else {
        output({ type: 'reconnecting', reason });
      }
    } else if (connection === 'open') {
      output({ type: 'connected' });
      setTimeout(() => process.exit(0), 2000);
    }
  });
}

run().catch((err) => {
  output({ type: 'error', message: err.message });
  process.exit(1);
});
