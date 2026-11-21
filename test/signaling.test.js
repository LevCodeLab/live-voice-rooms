import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createVoiceRoomServer } from '../src/server.js';
import { resetSignalingState } from '../src/services/signalingServer.js';
import { resetChannelStore } from '../src/controllers/liveController.js';

let activeServer = null;

afterEach(async () => {
  resetSignalingState();
  resetChannelStore();
  if (activeServer) {
    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;
  }
});

function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    function onMsg(raw) {
      const parsed = JSON.parse(raw.toString());
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(parsed);
      }
    }

    ws.on('message', onMsg);
  });
}

test('WebRTC signaling relays SDP offer, answer, ICE candidates, and chat between host and listener', async () => {
  const { server } = createVoiceRoomServer({ gracePeriodMs: 50 });
  activeServer = server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}`;

  const hostWs = new WebSocket(wsUrl);
  const hostInit = await waitForMessage(hostWs, (m) => m.type === 'INIT');
  assert.ok(hostInit.clientId.startsWith('peer_'));

  const startedP = waitForMessage(hostWs, (m) => m.type === 'BROADCAST_STARTED');
  hostWs.send(JSON.stringify({
    type: 'BROADCAST_START',
    frequency: '104.7',
    hostName: 'aarav_dev',
    title: 'Nightly Rust & WebRTC',
  }));
  const started = await startedP;
  assert.equal(started.listenersCount, 1);

  const listenerWs = new WebSocket(wsUrl);
  await waitForMessage(listenerWs, (m) => m.type === 'INIT');

  const newListenerP = waitForMessage(hostWs, (m) => m.type === 'NEW_LISTENER');
  const tunedInP = waitForMessage(listenerWs, (m) => m.type === 'TUNED_IN');

  listenerWs.send(JSON.stringify({
    type: 'TUNE_IN',
    frequency: '104.7',
  }));

  const [newListener, tunedIn] = await Promise.all([newListenerP, tunedInP]);
  assert.equal(tunedIn.hostName, 'aarav_dev');
  assert.equal(tunedIn.listenersCount, 2);
  assert.ok(newListener.listenerId);

  // Host sends WebRTC offer -> Listener receives it
  const offerReceivedP = waitForMessage(listenerWs, (m) => m.type === 'WEBRTC_OFFER');
  hostWs.send(JSON.stringify({
    type: 'WEBRTC_OFFER',
    targetId: newListener.listenerId,
    frequency: '104.7',
    sdp: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
  }));
  const offerMsg = await offerReceivedP;
  assert.equal(offerMsg.sdp.type, 'offer');

  // Listener sends WebRTC answer -> Host receives it
  const answerReceivedP = waitForMessage(hostWs, (m) => m.type === 'WEBRTC_ANSWER');
  listenerWs.send(JSON.stringify({
    type: 'WEBRTC_ANSWER',
    frequency: '104.7',
    sdp: { type: 'answer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
  }));
  const answerMsg = await answerReceivedP;
  assert.equal(answerMsg.sdp.type, 'answer');
  assert.equal(answerMsg.listenerId, newListener.listenerId);

  // Room chat broadcast
  const chatReceivedP = waitForMessage(listenerWs, (m) => m.type === 'ROOM_CHAT_MESSAGE');
  hostWs.send(JSON.stringify({
    type: 'ROOM_CHAT',
    frequency: '104.7',
    text: 'mic check 1 2 3',
    user: { name: 'aarav_dev' },
  }));
  const chatMsg = await chatReceivedP;
  assert.equal(chatMsg.message.text, 'mic check 1 2 3');

  hostWs.close();
  listenerWs.close();
});

test('HTTP /api/live endpoints create, join, inspect, and close voice channels', async () => {
  const { server } = createVoiceRoomServer({ gracePeriodMs: 50 });
  activeServer = server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/live`;

  const createRes = await fetch(`${base}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frequency: '101.7', hostUserId: 'host_01', maxGuests: 2 }),
  });
  assert.equal(createRes.status, 201);
  const { channelId } = await createRes.json();

  const joinRes = await fetch(`${base}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, userId: 'guest_a' }),
  });
  assert.equal(joinRes.status, 200);

  const statusRes = await fetch(`${base}/status/${channelId}`);
  const status = await statusRes.json();
  assert.equal(status.currentGuests, 1);
  assert.equal(status.isLive, true);

  const stationRes = await fetch(`${base}/station/101.7`);
  const station = await stationRes.json();
  assert.equal(station.isLive, true);
});
