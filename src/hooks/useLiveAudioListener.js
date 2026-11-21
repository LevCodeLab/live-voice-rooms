import { useState, useEffect, useRef, useCallback } from 'react';
import { ICE_SERVERS, getSignalingUrl } from '../services/webrtcConfig.js';

/**
 * useLiveAudioListener
 * Receives and plays live WebRTC audio from the room broadcaster.
 * Routes remote MediaStream directly to an unmuted <audio> element while using
 * an isolated Web Audio AnalyserNode for speaking detection.
 */
export function useLiveAudioListener({
  frequency = '00.0',
  isHostOnAir = false,
  isListeningActive = false,
  onStationStatusChange = null,
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isStationLive, setIsStationLive] = useState(false);
  const [stationInfo, setStationInfo] = useState(null);
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const [isHostSpeaking, setIsHostSpeaking] = useState(false);
  const [hostIsMuted, setHostIsMuted] = useState(false);
  const [listenersCount, setListenersCount] = useState(1);
  const [allLiveStations, setAllLiveStations] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [speakRequestStatus, setSpeakRequestStatus] = useState('idle');

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const audioElRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const currentHostIdRef = useRef(null);

  useEffect(() => {
    if (!audioElRef.current) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      audio.setAttribute('autoplay', 'true');
      audioElRef.current = audio;
      document.body.appendChild(audio);
    }

    return () => {
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.srcObject = null;
        if (audioElRef.current.parentNode) {
          audioElRef.current.parentNode.removeChild(audioElRef.current);
        }
        audioElRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isHostOnAir) {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setIsReceivingAudio(false);
      return;
    }

    let isSubscribed = true;
    const ws = new WebSocket(getSignalingUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isSubscribed) return;
      setIsConnected(true);

      if (isListeningActive && frequency && frequency !== '00.0') {
        ws.send(JSON.stringify({
          type: 'TUNE_IN',
          frequency,
        }));
      }

      ws.send(JSON.stringify({
        type: 'GET_ACTIVE_STATIONS',
      }));
    };

    ws.onmessage = async (event) => {
      if (!isSubscribed) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (data.type) {
        case 'INIT': {
          if (Array.isArray(data.activeStations)) {
            setAllLiveStations(data.activeStations);
            onStationStatusChange?.(data.activeStations);
          }
          break;
        }

        case 'ACTIVE_STATIONS': {
          if (Array.isArray(data.stations)) {
            setAllLiveStations(data.stations);
            onStationStatusChange?.(data.stations);
          }
          break;
        }

        case 'TUNED_IN': {
          if (data.frequency === frequency) {
            setIsStationLive(true);
            setStationInfo(data);
            setListenersCount(data.listenersCount || 1);
            if (Array.isArray(data.recentMessages)) {
              setChatMessages(data.recentMessages);
            }
          }
          break;
        }

        case 'ROOM_CHAT_MESSAGE': {
          if (data.frequency === frequency && data.message) {
            setChatMessages((prev) => [...prev.slice(-50), data.message]);
          }
          break;
        }

        case 'ROOM_REACTION_BURST': {
          if (data.frequency === frequency && data.reaction) {
            setFloatingReactions((prev) => [...prev.slice(-20), data.reaction]);
          }
          break;
        }

        case 'SPEAK_DECISION_RESULT': {
          if (data.frequency === frequency) {
            setSpeakRequestStatus(data.accepted ? 'accepted' : 'idle');
          }
          break;
        }

        case 'STATION_OFFLINE': {
          if (data.frequency === frequency) {
            setIsStationLive(false);
            setIsReceivingAudio(false);
            setRemoteAudioLevel(0);
            setIsHostSpeaking(false);
            if (audioElRef.current) {
              audioElRef.current.srcObject = null;
            }
          }
          break;
        }

        case 'STATION_STATUS': {
          if (data.frequency === frequency) {
            setIsStationLive(data.isLive);
            setListenersCount(data.listenersCount || 1);
            if (!data.isLive) {
              setIsReceivingAudio(false);
              setRemoteAudioLevel(0);
              setIsHostSpeaking(false);
              if (audioElRef.current) audioElRef.current.srcObject = null;
            }
          }

          setAllLiveStations((prev) => {
            const updated = prev.filter((s) => s.frequency !== data.frequency);
            if (data.isLive) {
              updated.push({
                frequency: data.frequency,
                isLive: true,
                hostName: data.hostName,
                title: data.title,
                topic: data.topic,
                listenersCount: data.listenersCount || 1,
              });
            }
            onStationStatusChange?.(updated);
            return updated;
          });
          break;
        }

        case 'LISTENERS_COUNT': {
          if (data.frequency === frequency) {
            setListenersCount(data.listenersCount || 1);
          }
          break;
        }

        case 'HOST_MUTE_STATE': {
          if (data.frequency === frequency) {
            setHostIsMuted(Boolean(data.isMuted));
            if (data.isMuted) {
              setIsHostSpeaking(false);
              setRemoteAudioLevel(0);
            }
          }
          break;
        }

        case 'WEBRTC_OFFER': {
          const { sdp } = data;
          if (!sdp) return;

          let pc = pcRef.current;
          const isNewHost = currentHostIdRef.current !== data.hostId;
          const isClosed = !pc || pc.signalingState === 'closed';

          if (isClosed || isNewHost) {
            if (pc) {
              try { pc.close(); } catch {}
            }
            pc = new RTCPeerConnection(ICE_SERVERS);
            pcRef.current = pc;
            currentHostIdRef.current = data.hostId;
          }

          pc.ontrack = (e) => {
            let remoteStream = e.streams && e.streams[0];
            if (!remoteStream && e.track) {
              remoteStream = new MediaStream([e.track]);
            }
            if (!remoteStream) return;

            if (audioElRef.current) {
              audioElRef.current.srcObject = remoteStream;
              audioElRef.current.muted = false;
              audioElRef.current.volume = 1.0;
              const p = audioElRef.current.play();
              if (p !== undefined) {
                p.then(() => {
                  setIsReceivingAudio(true);
                }).catch(() => {
                  const unlock = () => {
                    if (audioElRef.current) {
                      audioElRef.current.muted = false;
                      audioElRef.current.volume = 1.0;
                      audioElRef.current.play().then(() => setIsReceivingAudio(true)).catch(() => {});
                    }
                    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                      audioCtxRef.current.resume().catch(() => {});
                    }
                    window.removeEventListener('click', unlock);
                    window.removeEventListener('touchstart', unlock);
                    window.removeEventListener('touchend', unlock);
                  };
                  window.addEventListener('click', unlock, { once: true });
                  window.addEventListener('touchstart', unlock, { once: true });
                  window.addEventListener('touchend', unlock, { once: true });
                });
              }
            }

            try {
              const AudioCtx = window.AudioContext || window.webkitAudioContext;
              if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
                audioCtxRef.current = new AudioCtx();
              }
              const ctx = audioCtxRef.current;
              if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
              }
              const source = ctx.createMediaStreamSource(remoteStream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              analyser.smoothingTimeConstant = 0.5;
              source.connect(analyser);
              analyserRef.current = analyser;

              setIsReceivingAudio(true);

              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              const checkVolume = () => {
                if (!isSubscribed) return;
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                const avg = sum / dataArray.length;

                if (avg > 8) {
                  setIsHostSpeaking(true);
                  setRemoteAudioLevel(Math.min(100, Math.round((avg / 60) * 100)));
                } else {
                  setIsHostSpeaking(false);
                  setRemoteAudioLevel(0);
                }
                animFrameRef.current = requestAnimationFrame(checkVolume);
              };
              animFrameRef.current = requestAnimationFrame(checkVolume);
            } catch {}
          };

          pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'ICE_CANDIDATE',
                targetId: data.hostId,
                candidate: e.candidate,
                frequency,
              }));
            }
          };

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            while (pendingIceCandidatesRef.current.length > 0) {
              const cand = pendingIceCandidatesRef.current.shift();
              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch {}
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'WEBRTC_ANSWER',
                sdp: answer,
                frequency,
              }));
            }
          } catch (err) {
            console.error('[Listener] Error handling offer:', err);
          }
          break;
        }

        case 'ICE_CANDIDATE': {
          if (data.candidate) {
            if (pcRef.current && pcRef.current.remoteDescription) {
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
              } catch {}
            } else {
              pendingIceCandidatesRef.current.push(data.candidate);
            }
          }
          break;
        }

        case 'BROADCAST_ENDED': {
          if (data.frequency === frequency) {
            setIsStationLive(false);
            setIsReceivingAudio(false);
            setRemoteAudioLevel(0);
            setIsHostSpeaking(false);
            if (pcRef.current) {
              pcRef.current.close();
              pcRef.current = null;
            }
            if (audioElRef.current) {
              audioElRef.current.srcObject = null;
            }
          }
          break;
        }
      }
    };

    let reconnectTimer = null;

    ws.onclose = () => {
      setIsConnected(false);
      if (isSubscribed && !isHostOnAir) {
        reconnectTimer = setTimeout(() => {
          if (isSubscribed && !isHostOnAir) {
            const nextWs = new WebSocket(getSignalingUrl());
            wsRef.current = nextWs;
            nextWs.onopen = ws.onopen;
            nextWs.onmessage = ws.onmessage;
            nextWs.onclose = ws.onclose;
          }
        }, 2500);
      }
    };

    return () => {
      isSubscribed = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (ws.readyState === WebSocket.OPEN) {
        if (isListeningActive && frequency && frequency !== '00.0') {
          ws.send(JSON.stringify({ type: 'TUNE_OUT', frequency }));
        }
        ws.close();
      }
    };
  }, [frequency, isHostOnAir]);

  useEffect(() => {
    if (isHostOnAir || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (isListeningActive && frequency && frequency !== '00.0') {
      wsRef.current.send(JSON.stringify({
        type: 'TUNE_IN',
        frequency,
      }));
    } else if (!isListeningActive) {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (audioElRef.current) {
        audioElRef.current.srcObject = null;
      }
      setIsReceivingAudio(false);
      setIsStationLive(false);
      if (frequency && frequency !== '00.0') {
        wsRef.current.send(JSON.stringify({
          type: 'TUNE_OUT',
          frequency,
        }));
      }
    }
  }, [isListeningActive, frequency, isHostOnAir]);

  const sendChatMessage = useCallback((text, user) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'ROOM_CHAT',
        frequency,
        text,
        user,
      }));
    }
  }, [frequency]);

  const sendReaction = useCallback((emoji, user) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'ROOM_REACTION',
        frequency,
        emoji,
        user,
      }));
    }
  }, [frequency]);

  const requestToSpeak = useCallback((user) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setSpeakRequestStatus('pending');
      wsRef.current.send(JSON.stringify({
        type: 'REQUEST_SPEAK',
        frequency,
        user,
      }));
    }
  }, [frequency]);

  const unlockAudio = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtx();
        }
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
        }
      }
      if (audioElRef.current) {
        audioElRef.current.muted = false;
        audioElRef.current.volume = 1.0;
        audioElRef.current.play().catch(() => {});
      }
    } catch {}
  }, []);

  return {
    isConnected,
    isStationLive,
    stationInfo,
    isReceivingAudio,
    remoteAudioLevel,
    isHostSpeaking,
    hostIsMuted,
    listenersCount,
    allLiveStations,
    chatMessages,
    floatingReactions,
    speakRequestStatus,
    sendChatMessage,
    sendReaction,
    requestToSpeak,
    unlockAudio,
  };
}
