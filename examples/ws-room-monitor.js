/**
 * Minimal headless WebSocket room monitor example.
 * Connects to a running live-voice-rooms signaling server and logs active broadcasts.
 *
 * Usage:
 *   node examples/ws-room-monitor.js ws://localhost:3000
 */
import WebSocket from 'ws';

const url = process.argv[2] || 'ws://localhost:3000';
const ws = new WebSocket(url);

ws.on('open', () => {
  console.log(`[monitor] connected to ${url}`);
  ws.send(JSON.stringify({ type: 'GET_ACTIVE_STATIONS' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'ACTIVE_STATIONS') {
    console.log('[monitor] active rooms:', msg.stations);
    ws.close();
  }
});
