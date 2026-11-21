/**
 * WebRTC STUN/TURN & Signaling Configuration for Live Voice Rooms
 */

export const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 10,
};

/**
 * Resolve WebSocket signaling server URL from runtime overrides, Vite env, or window host.
 */
export function getSignalingUrl() {
  if (typeof window === 'undefined') return 'ws://localhost:3000';

  if (window.__VOICE_ROOMS_SIGNALING_URL) {
    return window.__VOICE_ROOMS_SIGNALING_URL;
  }

  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SIGNALING_URL) {
    return import.meta.env.VITE_SIGNALING_URL;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (window.location.port === '5173') {
    return `${protocol}//${window.location.hostname}:3000`;
  }

  return `${protocol}//${window.location.host}`;
}
