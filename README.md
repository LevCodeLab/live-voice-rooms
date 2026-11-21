# live-voice-rooms

![WebRTC](https://img.shields.io/badge/WebRTC-Opus_Audio-141418?style=flat-square&color=141418&labelColor=26262E)
![Signaling](https://img.shields.io/badge/WebSocket-ws_8.x-141418?style=flat-square&color=141418&labelColor=26262E)
![Frontend](https://img.shields.io/badge/React-Vite-141418?style=flat-square&color=141418&labelColor=26262E)
![License](https://img.shields.io/badge/License-MIT-141418?style=flat-square&color=141418&labelColor=26262E)

Browser WebRTC live audio rooms with 1-click host mic broadcast, multi-listener P2P audio, live FFT voice activity detection, and a lightweight Node.js WebSocket signaling server.

Built this after getting annoyed at heavy third-party audio SDKs charging per-minute just to stream one person talking to 15 friends at 2am over chai. No bloated media servers needed for small rooms: the host opens a mic, WebSocket forwards SDP offers + ICE candidates, and listeners hear clean Opus audio straight in the browser.

![live-voice-rooms UI preview](./assets/preview.svg)

## What this thing actually does

- **1-to-many browser WebRTC broadcast**: Host captures mic audio once and spins up peer connections per listener with buffered ICE candidate flushing and stable renegotiation.
- **Chrome clock-drift fix included**: Listener audio goes straight into an unmuted HTML5 `<audio>` element while the Web Audio `AnalyserNode` runs without destination routing (if you route WebRTC MediaStreams through `audioCtx.destination` on desktop Chrome, it randomly goes silent after a few minutes; not a bug bhai, classic Chromium quirk).
- **35-second host reconnect grace window**: If the host refreshes a tab or switches Wi-Fi, the room holds existing listeners instead of kicking everyone out.
- **Built-in room chat & speaker hand-raise queue**: Listeners can chat or raise a hand over the same WebSocket connection without extra dependencies.

## Run it in 60 seconds

```bash
git clone https://github.com/LevCodeLab/live-voice-rooms.git
cd live-voice-rooms
npm install

# Terminal 1: start HTTP + WebSocket signaling server on :3000
npm run dev:server

# Terminal 2: start Vite React UI on :5173
npm run dev:web
```

Open two browser tabs at `http://localhost:5173`:
1. Tab 1: Stay in **Host Mode**, pick `104.7 FM`, click **Go On Air**.
2. Tab 2: Switch to **Listener Mode**, pick `104.7 FM`, click **Tune In**.

Run the automated signaling & REST test suite anytime:

```bash
npm test
```

## Where to edit stuff

| File | What lives here |
| :--- | :--- |
| `src/services/signalingServer.js` | WebSocket room registry, SDP offer/answer relay, ICE forwarding, chat, and host grace timer |
| `src/services/webrtcConfig.js` | STUN/TURN ICE server list and signaling URL resolver |
| `src/hooks/useLiveAudioBroadcast.js` | Host WebRTC peer map, mic capture, FFT speaking meter, and hardware track mute sync |
| `src/hooks/useLiveAudioListener.js` | Listener `RTCPeerConnection` answer flow, `<audio>` playback unlock, and remote VAD |
| `src/hooks/useBroadcastAudio.js` | Standalone local mic + `BroadcastChannel` multi-tab speaking detector hook |
| `src/controllers/liveController.js` | Express HTTP handlers (`/api/live/create`, `/join`, `/leave`, `/station/:frequency`) |
| `src/App.jsx` | Minimal dark-obsidian host & listener room UI |

## License

MIT License. Clone it, break it, ship it.
