import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import liveRouter from './routes/live.js';
import { initSignalingServer } from './services/signalingServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createVoiceRoomServer(options = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'live-voice-rooms' });
  });

  app.use('/api/live', liveRouter);

  const distDir = path.resolve(__dirname, '../dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  const server = http.createServer(app);
  const signaling = initSignalingServer(server, options);

  return { app, server, signaling };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createVoiceRoomServer();
  server.listen(port, () => {
    console.log(`[live-voice-rooms] HTTP + WebRTC signaling server listening on http://localhost:${port}`);
  });
}
