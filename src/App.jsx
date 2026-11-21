import React, { useState } from 'react';
import { Mic, MicOff, Radio, Headphones, Hand, Send, Users } from 'lucide-react';
import { useLiveAudioBroadcast } from './hooks/useLiveAudioBroadcast.js';
import { useLiveAudioListener } from './hooks/useLiveAudioListener.js';

const PRESET_CHANNELS = ['104.7', '101.7', '098.8', '094.2'];

export default function App() {
  const [role, setRole] = useState('host');
  const [frequency, setFrequency] = useState('104.7');
  const [hostName, setHostName] = useState('dev_host');
  const [roomTitle, setRoomTitle] = useState('Late Night Systems & Audio');
  const [isOnAir, setIsOnAir] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isTunedIn, setIsTunedIn] = useState(false);
  const [chatDraft, setChatDraft] = useState('');

  const broadcaster = useLiveAudioBroadcast({
    isOnAir: role === 'host' && isOnAir,
    frequency,
    hostName,
    roomTitle,
    isMuted,
  });

  const listener = useLiveAudioListener({
    frequency,
    isHostOnAir: role === 'host' && isOnAir,
    isListeningActive: role === 'listener' && isTunedIn,
  });

  const activeSpeaking = role === 'host' ? broadcaster.isSpeaking : listener.isHostSpeaking;
  const activeLevel = role === 'host' ? broadcaster.audioLevel : listener.remoteAudioLevel;
  const activeCount = role === 'host' ? broadcaster.listenersCount : listener.listenersCount;
  const messages = role === 'host' ? broadcaster.chatMessages : listener.chatMessages;

  const bars = Array.from({ length: 24 }, (_, idx) => {
    if (!activeSpeaking || activeLevel === 0) return 8;
    const envelope = Math.sin(((idx + 1) / 24) * Math.PI);
    return Math.max(8, Math.round(8 + (activeLevel / 100) * 48 * envelope));
  });

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    if (role === 'host') {
      broadcaster.sendChatMessage(chatDraft, { name: hostName });
    } else {
      listener.sendChatMessage(chatDraft, { name: 'listener' });
    }
    setChatDraft('');
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-row">
          <Radio size={20} />
          <span className="brand-title">live-voice-rooms</span>
          <span className="mono-pill">
            <span className={`status-dot ${(isOnAir || listener.isStationLive) ? 'live' : ''}`} />
            {frequency} MHz
          </span>
          <span className="mono-pill">
            <Users size={12} />
            {activeCount} in room
          </span>
        </div>

        <div className="mode-switch">
          <button
            type="button"
            className={`btn ${role === 'host' ? 'active' : ''}`}
            onClick={() => {
              setIsTunedIn(false);
              setRole('host');
            }}
          >
            <Mic size={14} />
            Host Mode
          </button>
          <button
            type="button"
            className={`btn ${role === 'listener' ? 'active' : ''}`}
            onClick={() => {
              setIsOnAir(false);
              setRole('listener');
            }}
          >
            <Headphones size={14} />
            Listener Mode
          </button>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <div className="section-label">Channel Frequency</div>
          <div className="freq-row">
            {PRESET_CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                className={`btn ${frequency === ch ? 'active' : ''}`}
                onClick={() => setFrequency(ch)}
              >
                {ch} FM
              </button>
            ))}
          </div>

          {role === 'host' ? (
            <>
              <div className="section-label">Broadcast Metadata</div>
              <div className="input-row">
                <input
                  className="text-input"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="Host handle"
                />
                <input
                  className="text-input"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  placeholder="Room title"
                />
              </div>

              <div className="section-label">WebRTC Voice Stream</div>
              <div className="wave-box">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className={`wave-bar ${activeSpeaking ? '' : 'idle'}`}
                    style={{ height: `${h}px` }}
                  />
                ))}
              </div>

              <div className="controls-row">
                {!isOnAir ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setIsOnAir(true)}
                  >
                    <Radio size={15} />
                    Go On Air
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setIsMuted((m) => !m)}
                    >
                      {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                      {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setIsOnAir(false)}
                    >
                      End Broadcast
                    </button>
                  </>
                )}
              </div>

              {broadcaster.speakerQueue.length > 0 && (
                <div>
                  <div className="section-label" style={{ marginBottom: 8 }}>Speaker Requests</div>
                  <div className="controls-row">
                    {broadcaster.speakerQueue.map((req) => (
                      <div key={req.listenerId} className="mono-pill">
                        <span>{req.name}</span>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={() => broadcaster.respondToSpeaker(req.listenerId, true)}
                        >
                          Approve
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="section-label">Live Stream Status</div>
              <div className="muted-note">
                {listener.isStationLive
                  ? `Connected to ${listener.stationInfo?.title || frequency} (Host: ${listener.stationInfo?.hostName || 'Host'})`
                  : `Waiting for broadcaster on ${frequency} FM`}
              </div>

              <div className="wave-box">
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className={`wave-bar ${activeSpeaking ? '' : 'idle'}`}
                    style={{ height: `${h}px` }}
                  />
                ))}
              </div>

              <div className="controls-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    listener.unlockAudio();
                    setIsTunedIn((v) => !v);
                  }}
                >
                  <Headphones size={15} />
                  {isTunedIn ? 'Leave Room' : 'Tune In'}
                </button>
                {isTunedIn && listener.isStationLive && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => listener.requestToSpeak({ name: 'listener' })}
                  >
                    <Hand size={15} />
                    {listener.speakRequestStatus === 'pending'
                      ? 'Hand Raised'
                      : listener.speakRequestStatus === 'accepted'
                        ? 'Speaker Approved'
                        : 'Raise Hand'}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="card">
          <div className="section-label">Room Chat</div>
          <div className="chat-log">
            {messages.length === 0 ? (
              <div className="muted-note">No messages in this room yet.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="chat-item">
                  <span className="chat-sender">{m.senderName}:</span>
                  <span>{m.text}</span>
                </div>
              ))
            )}
          </div>
          <form className="input-row" onSubmit={handleSendChat}>
            <input
              className="text-input"
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="Send message to room..."
            />
            <button type="submit" className="btn btn-primary">
              <Send size={14} />
              Send
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
