/**
 * Real-Time WebRTC Audio Signaling Server
 * Manages live audio rooms, 1-to-many WebRTC SDP offer/answer forwarding,
 * ICE candidate exchange, hardware mute sync, room chat, and speaker requests.
 */
import { WebSocketServer, WebSocket } from 'ws';

const rooms = new Map();
const clients = new Map();

export function getActiveRoomsSummary() {
  const summary = [];
  for (const [freq, room] of rooms.entries()) {
    summary.push({
      frequency: freq,
      isLive: true,
      hostId: room.hostId,
      hostName: room.hostName || 'Room Host',
      title: room.title,
      topic: room.topic || 'General Voice',
      listenersCount: room.listeners.size + 1,
      createdAt: room.createdAt,
    });
  }
  return summary;
}

function broadcastToAll(data) {
  const msg = JSON.stringify(data);
  for (const [ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastToRoom(room, data, excludeWs = null) {
  const msg = JSON.stringify(data);
  if (room.hostSocket && room.hostSocket !== excludeWs && room.hostSocket.readyState === WebSocket.OPEN) {
    room.hostSocket.send(msg);
  }
  for (const [, ws] of room.listeners.entries()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function initSignalingServer(server, options = {}) {
  const gracePeriodMs = options.gracePeriodMs ?? 35000;
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const clientId = 'peer_' + Math.random().toString(36).substring(2, 9);
    clients.set(ws, { id: clientId, role: null, frequency: null });

    ws.send(JSON.stringify({
      type: 'INIT',
      clientId,
      activeStations: getActiveRoomsSummary(),
    }));

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const client = clients.get(ws);
      if (!client) return;

      switch (data.type) {
        case 'BROADCAST_START': {
          const { frequency, hostId, hostName, title, topic } = data;
          if (!frequency) return;

          const oldRoom = rooms.get(frequency);
          if (oldRoom?.disconnectTimer) {
            clearTimeout(oldRoom.disconnectTimer);
            oldRoom.disconnectTimer = null;
          }
          const preservedListeners = oldRoom?.listeners instanceof Map ? oldRoom.listeners : new Map();
          const preservedMessages = Array.isArray(oldRoom?.messages) ? oldRoom.messages : [];

          const newRoom = {
            frequency,
            hostId: hostId || client.id,
            hostName: hostName || (oldRoom ? oldRoom.hostName : 'Room Broadcaster'),
            hostSocket: ws,
            title: title || (oldRoom ? oldRoom.title : `Live Voice Room ${frequency}`),
            topic: topic || (oldRoom ? oldRoom.topic : 'Open Discussion'),
            listeners: preservedListeners,
            messages: preservedMessages,
            speakerQueue: new Map(),
            isMuted: false,
            createdAt: oldRoom?.createdAt || Date.now(),
          };

          rooms.set(frequency, newRoom);
          client.role = 'host';
          client.frequency = frequency;

          const totalListenersCount = preservedListeners.size + 1;

          ws.send(JSON.stringify({
            type: 'BROADCAST_STARTED',
            frequency,
            listenersCount: totalListenersCount,
          }));

          broadcastToAll({
            type: 'STATION_STATUS',
            frequency,
            isLive: true,
            hostName: newRoom.hostName,
            title: newRoom.title,
            topic: newRoom.topic,
            listenersCount: totalListenersCount,
          });

          preservedListeners.forEach((listenerWs, lId) => {
            if (listenerWs && listenerWs.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'NEW_LISTENER',
                listenerId: lId,
                frequency,
              }));
              listenerWs.send(JSON.stringify({
                type: 'TUNED_IN',
                frequency,
                hostId: newRoom.hostId,
                hostName: newRoom.hostName,
                title: newRoom.title,
                topic: newRoom.topic,
                listenersCount: totalListenersCount,
              }));
            }
          });
          break;
        }

        case 'TUNE_IN': {
          const { frequency, listenerId } = data;
          if (!frequency) return;

          client.role = 'listener';
          client.frequency = frequency;
          const lId = listenerId || client.id;

          const room = rooms.get(frequency);
          if (room) {
            if (!(room.listeners instanceof Map)) {
              room.listeners = new Map();
            }
            room.listeners.set(lId, ws);

            const count = room.listeners.size + (room.hostSocket ? 1 : 0);

            ws.send(JSON.stringify({
              type: 'TUNED_IN',
              frequency,
              hostId: room.hostId,
              hostName: room.hostName,
              title: room.title,
              topic: room.topic,
              listenersCount: count,
              recentMessages: room.messages || [],
            }));

            if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
              room.hostSocket.send(JSON.stringify({
                type: 'NEW_LISTENER',
                listenerId: lId,
                frequency,
              }));
            }

            broadcastToRoom(room, {
              type: 'LISTENERS_COUNT',
              frequency,
              listenersCount: count,
            });

            broadcastToAll({
              type: 'STATION_UPDATE',
              frequency,
              listenersCount: count,
            });
          } else {
            ws.send(JSON.stringify({
              type: 'STATION_OFFLINE',
              frequency,
            }));
          }
          break;
        }

        case 'TUNE_OUT': {
          const { frequency, listenerId } = data;
          const freq = frequency || client.frequency;
          const lId = listenerId || client.id;

          if (freq && rooms.has(freq)) {
            const room = rooms.get(freq);
            room.listeners.delete(lId);

            const count = room.listeners.size + 1;

            if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
              room.hostSocket.send(JSON.stringify({
                type: 'LISTENER_LEFT',
                listenerId: lId,
                frequency: freq,
              }));
            }

            broadcastToRoom(room, {
              type: 'LISTENERS_COUNT',
              frequency: freq,
              listenersCount: count,
            });

            broadcastToAll({
              type: 'STATION_UPDATE',
              frequency: freq,
              listenersCount: count,
            });
          }
          client.frequency = null;
          break;
        }

        case 'WEBRTC_OFFER': {
          const target = data.targetId || data.listenerId;
          const { sdp, frequency } = data;
          if (!target || !sdp) return;

          let room = rooms.get(frequency || client.frequency);
          if (!room) {
            for (const r of rooms.values()) {
              if (r.listeners.has(target)) {
                room = r;
                break;
              }
            }
          }

          if (room) {
            const targetWs = room.listeners.get(target);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify({
                type: 'WEBRTC_OFFER',
                sdp,
                hostId: client.id,
                frequency: room.frequency,
              }));
            }
          }
          break;
        }

        case 'WEBRTC_ANSWER': {
          const { sdp, frequency } = data;
          if (!sdp) return;

          let room = rooms.get(frequency || client.frequency);
          if (!room) {
            for (const r of rooms.values()) {
              if (r.listeners.has(client.id)) {
                room = r;
                break;
              }
            }
          }

          if (room && room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
            room.hostSocket.send(JSON.stringify({
              type: 'WEBRTC_ANSWER',
              sdp,
              listenerId: client.id,
              frequency: room.frequency,
            }));
          }
          break;
        }

        case 'ICE_CANDIDATE': {
          const target = data.targetId || data.listenerId || data.hostId;
          const { candidate, frequency } = data;
          if (!candidate) return;

          let room = rooms.get(frequency || client.frequency);
          if (!room) {
            for (const r of rooms.values()) {
              if (r.listeners.has(target) || (r.hostSocket && (r.hostId === target || clients.get(r.hostSocket)?.id === target))) {
                room = r;
                break;
              }
            }
          }

          if (room) {
            if (client.role === 'host') {
              if (target && room.listeners.has(target)) {
                const targetWs = room.listeners.get(target);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                  targetWs.send(JSON.stringify({
                    type: 'ICE_CANDIDATE',
                    candidate,
                    senderId: client.id,
                    frequency: room.frequency,
                  }));
                }
              }
            } else if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
              room.hostSocket.send(JSON.stringify({
                type: 'ICE_CANDIDATE',
                candidate,
                senderId: client.id,
                frequency: room.frequency,
              }));
            }
          }
          break;
        }

        case 'MUTE_STATE': {
          const { frequency, isMuted } = data;
          const room = rooms.get(frequency || client.frequency);
          if (room) {
            room.isMuted = Boolean(isMuted);
            broadcastToRoom(room, {
              type: 'HOST_MUTE_STATE',
              frequency: room.frequency,
              isMuted: Boolean(isMuted),
            }, ws);
          }
          break;
        }

        case 'BROADCAST_END': {
          const freq = data.frequency || client.frequency;
          if (freq && rooms.has(freq)) {
            const room = rooms.get(freq);
            if (client.role === 'host' && room.hostSocket === ws) {
              if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
              broadcastToRoom(room, { type: 'BROADCAST_ENDED', frequency: freq });
              rooms.delete(freq);

              broadcastToAll({
                type: 'STATION_STATUS',
                frequency: freq,
                isLive: false,
                listenersCount: 0,
              });
            }
          }
          client.role = null;
          client.frequency = null;
          break;
        }

        case 'GET_ACTIVE_STATIONS': {
          ws.send(JSON.stringify({
            type: 'ACTIVE_STATIONS',
            stations: getActiveRoomsSummary(),
          }));
          break;
        }

        case 'ROOM_CHAT': {
          const { frequency, text, user } = data;
          if (!text || !text.trim()) return;

          const freq = frequency || client.frequency;
          const room = rooms.get(freq);
          if (room) {
            const isHost = client.role === 'host';
            const chatMsg = {
              id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              text: text.trim().slice(0, 300),
              senderId: client.id,
              senderName: user?.name || (isHost ? room.hostName : 'Guest Listener'),
              isHost,
              timestamp: Date.now(),
            };

            if (!room.messages) room.messages = [];
            room.messages.push(chatMsg);
            if (room.messages.length > 60) room.messages.shift();

            broadcastToRoom(room, {
              type: 'ROOM_CHAT_MESSAGE',
              frequency: freq,
              message: chatMsg,
            });
          }
          break;
        }

        case 'ROOM_REACTION': {
          const { frequency, emoji, user } = data;
          if (!emoji) return;

          const freq = frequency || client.frequency;
          const room = rooms.get(freq);
          if (room) {
            broadcastToRoom(room, {
              type: 'ROOM_REACTION_BURST',
              frequency: freq,
              reaction: {
                id: 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                emoji,
                senderName: user?.name || (client.role === 'host' ? room.hostName : 'Listener'),
                timestamp: Date.now(),
              },
            });
          }
          break;
        }

        case 'REQUEST_SPEAK': {
          const { frequency, user } = data;
          const freq = frequency || client.frequency;
          const room = rooms.get(freq);
          if (room && room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
            if (!room.speakerQueue) room.speakerQueue = new Map();
            const reqData = {
              listenerId: client.id,
              name: user?.name || 'Listener',
              timestamp: Date.now(),
            };
            room.speakerQueue.set(client.id, reqData);

            room.hostSocket.send(JSON.stringify({
              type: 'SPEAKER_REQUESTED',
              frequency: freq,
              request: reqData,
              queue: Array.from(room.speakerQueue.values()),
            }));
          }
          break;
        }

        case 'SPEAK_DECISION': {
          const { frequency, listenerId, accepted } = data;
          const freq = frequency || client.frequency;
          const room = rooms.get(freq);
          if (room && client.role === 'host') {
            if (room.speakerQueue) room.speakerQueue.delete(listenerId);

            const targetWs = room.listeners.get(listenerId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify({
                type: 'SPEAK_DECISION_RESULT',
                frequency: freq,
                accepted: Boolean(accepted),
              }));
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (!client) return;

      if (client.role === 'host' && client.frequency) {
        const freq = client.frequency;
        const room = rooms.get(freq);
        if (room && room.hostSocket === ws) {
          room.hostSocket = null;
          if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
          room.disconnectTimer = setTimeout(() => {
            if (!room.hostSocket || room.hostSocket.readyState !== WebSocket.OPEN) {
              broadcastToRoom(room, { type: 'BROADCAST_ENDED', frequency: freq });
              rooms.delete(freq);

              broadcastToAll({
                type: 'STATION_STATUS',
                frequency: freq,
                isLive: false,
                listenersCount: 0,
              });
            }
          }, gracePeriodMs);
        }
      } else if (client.role === 'listener' && client.frequency) {
        if (rooms.has(client.frequency)) {
          const room = rooms.get(client.frequency);
          room.listeners.delete(client.id);

          const count = room.listeners.size + 1;
          if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
            room.hostSocket.send(JSON.stringify({
              type: 'LISTENER_LEFT',
              listenerId: client.id,
              frequency: client.frequency,
            }));
          }

          broadcastToRoom(room, {
            type: 'LISTENERS_COUNT',
            frequency: client.frequency,
            listenersCount: count,
          });

          broadcastToAll({
            type: 'STATION_UPDATE',
            frequency: client.frequency,
            listenersCount: count,
          });
        }
      }

      clients.delete(ws);
    });
  });

  return {
    wss,
    getActiveRoomsSummary,
    registerHttpRoom,
    endHttpRoom,
    resetSignalingState,
  };
}

export function registerHttpRoom({ frequency, hostId, hostName, title, topic }) {
  if (!frequency) return null;
  const existing = rooms.get(frequency);
  const room = {
    frequency,
    hostId: hostId || (existing ? existing.hostId : 'host_' + Math.random().toString(36).substring(2, 7)),
    hostName: hostName || (existing ? existing.hostName : 'Room Host'),
    hostSocket: existing ? existing.hostSocket : null,
    title: title || (existing ? existing.title : `Live Voice Room ${frequency}`),
    topic: topic || (existing ? existing.topic : 'Open Discussion'),
    listeners: existing ? existing.listeners : new Map(),
    messages: existing ? existing.messages : [],
    speakerQueue: existing ? existing.speakerQueue : new Map(),
    isMuted: existing ? existing.isMuted : false,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(frequency, room);
  broadcastToAll({
    type: 'STATION_STATUS',
    frequency,
    isLive: true,
    hostName: room.hostName,
    title: room.title,
    topic: room.topic,
    listenersCount: room.listeners.size + 1,
  });
  return room;
}

export function endHttpRoom(frequency) {
  if (!frequency || !rooms.has(frequency)) return;
  const room = rooms.get(frequency);
  if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
  broadcastToRoom(room, { type: 'BROADCAST_ENDED', frequency });
  broadcastToAll({
    type: 'STATION_STATUS',
    frequency,
    isLive: false,
    listenersCount: 0,
  });
  rooms.delete(frequency);
}

export function resetSignalingState() {
  for (const room of rooms.values()) {
    if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
  }
  rooms.clear();
  clients.clear();
}
