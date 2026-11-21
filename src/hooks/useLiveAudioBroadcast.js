import { useState, useEffect, useRef, useCallback } from 'react';
import { ICE_SERVERS, getSignalingUrl } from '../services/webrtcConfig.js';

/**
 * useLiveAudioBroadcast
 * Manages live WebRTC audio broadcast for the room host.
 * Streams real microphone audio over P2P WebRTC to all connected listeners.
 */
export function useLiveAudioBroadcast({
  isOnAir = false,
  frequency = '104.7',
  hostName = 'Host',
  roomTitle = 'Late Night Systems Talk',
  topic = 'Engineering',
  isMuted = false,
  prewarmedStream = null,
}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [listenersCount, setListenersCount] = useState(1);
  const [hasMicPermission, setHasMicPermission] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [chatMessages, setChatMessages] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [speakerQueue, setSpeakerQueue] = useState([]);

  const streamRef = useRef(prewarmedStream);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (prewarmedStream && prewarmedStream.getAudioTracks().some((t) => t.readyState === 'live')) {
      streamRef.current = prewarmedStream;
      setHasMicPermission(true);
    }
  }, [prewarmedStream]);

  const peerConnectionsRef = useRef(new Map());
  const pendingIceCandidatesRef = useRef(new Map());

  const hostNameRef = useRef(hostName);
  const roomTitleRef = useRef(roomTitle);
  const topicRef = useRef(topic);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    hostNameRef.current = hostName;
    roomTitleRef.current = roomTitle;
    topicRef.current = topic;
  }, [hostName, roomTitle, topic]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (!isOnAir) {
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'BROADCAST_END',
            frequency,
          }));
        }
        wsRef.current.close();
        wsRef.current = null;
      }

      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();

      setListenersCount(1);
      setConnectionStatus('idle');
      setChatMessages([]);
      setFloatingReactions([]);
      setSpeakerQueue([]);
      return;
    }

    let isSubscribed = true;
    const wsUrl = getSignalingUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      if (!isSubscribed) return;
      setConnectionStatus('connected');

      let waitCount = 0;
      while (
        (!streamRef.current || !streamRef.current.getAudioTracks().some((t) => t.readyState === 'live')) &&
        waitCount < 60 &&
        isSubscribed
      ) {
        await new Promise((r) => setTimeout(r, 100));
        waitCount++;
      }

      if (!isSubscribed) return;

      ws.send(JSON.stringify({
        type: 'BROADCAST_START',
        frequency,
        hostName: hostNameRef.current,
        title: roomTitleRef.current,
        topic: topicRef.current,
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
        case 'BROADCAST_STARTED': {
          setListenersCount(data.listenersCount || 1);
          break;
        }

        case 'LISTENERS_COUNT': {
          if (data.frequency === frequency) {
            setListenersCount(data.listenersCount || 1);
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

        case 'SPEAKER_REQUESTED': {
          if (data.frequency === frequency) {
            setSpeakerQueue(data.queue || []);
          }
          break;
        }

        case 'NEW_LISTENER': {
          const { listenerId } = data;
          if (!listenerId) return;

          const pc = new RTCPeerConnection(ICE_SERVERS);
          peerConnectionsRef.current.set(listenerId, pc);

          let waitCount = 0;
          while (
            (!streamRef.current || !streamRef.current.getAudioTracks().some((t) => t.readyState === 'live')) &&
            waitCount < 50
          ) {
            await new Promise((r) => setTimeout(r, 100));
            waitCount++;
          }

          if (
            (!streamRef.current || !streamRef.current.getAudioTracks().some((t) => t.readyState === 'live')) &&
            navigator.mediaDevices?.getUserMedia
          ) {
            try {
              let stream;
              try {
                stream = await navigator.mediaDevices.getUserMedia({
                  audio: { echoCancellation: true, autoGainControl: true, noiseSuppression: false },
                });
              } catch {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              }
              streamRef.current = stream;
              setHasMicPermission(true);
            } catch (e) {
              console.warn('[Broadcaster] Direct getUserMedia fallback error:', e);
            }
          }

          if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
            streamRef.current.getAudioTracks().forEach((track) => {
              track.enabled = !isMutedRef.current;
              pc.addTrack(track, streamRef.current);
            });
          } else {
            try {
              pc.addTransceiver('audio', { direction: 'sendonly' });
            } catch {}
          }

          pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'ICE_CANDIDATE',
                targetId: listenerId,
                candidate: e.candidate,
                frequency,
              }));
            }
          };

          pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              pc.close();
              peerConnectionsRef.current.delete(listenerId);
              pendingIceCandidatesRef.current.delete(listenerId);
            }
          };

          try {
            const offer = await pc.createOffer({
              offerToReceiveAudio: false,
              offerToReceiveVideo: false,
            });
            await pc.setLocalDescription(offer);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'WEBRTC_OFFER',
                targetId: listenerId,
                sdp: offer,
                frequency,
              }));
            }
          } catch (err) {
            console.error('[Broadcaster] Error creating offer:', err);
          }
          break;
        }

        case 'WEBRTC_ANSWER': {
          const { listenerId, sdp } = data;
          const pc = peerConnectionsRef.current.get(listenerId);
          if (pc && sdp) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(sdp));
              const pending = pendingIceCandidatesRef.current.get(listenerId) || [];
              for (const cand of pending) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch {}
              }
              pendingIceCandidatesRef.current.delete(listenerId);
            } catch (err) {
              console.error('[Broadcaster] Error setting remote description:', err);
            }
          }
          break;
        }

        case 'ICE_CANDIDATE': {
          const { senderId, candidate } = data;
          const pc = peerConnectionsRef.current.get(senderId);
          if (pc && candidate) {
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch {}
            } else {
              if (!pendingIceCandidatesRef.current.has(senderId)) {
                pendingIceCandidatesRef.current.set(senderId, []);
              }
              pendingIceCandidatesRef.current.get(senderId).push(candidate);
            }
          }
          break;
        }

        case 'LISTENER_LEFT': {
          const { listenerId } = data;
          if (peerConnectionsRef.current.has(listenerId)) {
            peerConnectionsRef.current.get(listenerId).close();
            peerConnectionsRef.current.delete(listenerId);
            pendingIceCandidatesRef.current.delete(listenerId);
          }
          break;
        }
      }
    };

    let reconnectTimer = null;

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      if (isSubscribed && isOnAir) {
        reconnectTimer = setTimeout(() => {
          if (isSubscribed && isOnAir) {
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
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'BROADCAST_END', frequency }));
        ws.close();
      }
    };
  }, [isOnAir, frequency]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
    }

    if (isOnAir && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'MUTE_STATE',
        frequency,
        isMuted,
      }));
    }
  }, [isOnAir, isMuted, frequency]);

  useEffect(() => {
    if (!isOnAir) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setIsSpeaking(false);
      setAudioLevel(0);
      return;
    }

    let active = true;

    async function initMic() {
      try {
        let stream = prewarmedStream;

        if (!stream || !stream.getAudioTracks().some((t) => t.readyState === 'live')) {
          if (!navigator.mediaDevices?.getUserMedia) {
            setHasMicPermission(false);
            return;
          }

          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                autoGainControl: true,
                noiseSuppression: false,
              },
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }
        }

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setHasMicPermission(true);

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !isMutedRef.current;
        }

        peerConnectionsRef.current.forEach(async (pc, listenerId) => {
          try {
            const senders = pc.getSenders();
            const audioSender = senders.find((s) => (s.track && s.track.kind === 'audio') || s.kind === 'audio');
            if (audioSender && audioTrack) {
              await audioSender.replaceTrack(audioTrack);
            } else if (audioTrack) {
              pc.addTrack(audioTrack, stream);
            }

            const renegotiate = async () => {
              try {
                if (pc.signalingState !== 'stable') return;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: 'WEBRTC_OFFER',
                    targetId: listenerId,
                    sdp: offer,
                    frequency,
                  }));
                }
              } catch {}
            };

            if (pc.signalingState === 'stable') {
              await renegotiate();
            } else {
              const handleStable = () => {
                if (pc.signalingState === 'stable') {
                  pc.removeEventListener('signalingstatechange', handleStable);
                  renegotiate();
                }
              };
              pc.addEventListener('signalingstatechange', handleStable);
            }
          } catch {}
        });

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkVolume = () => {
          if (!active) return;

          if (isMutedRef.current) {
            setIsSpeaking(false);
            setAudioLevel(0);
            animFrameRef.current = requestAnimationFrame(checkVolume);
            return;
          }

          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }

          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;

          if (avg > 8) {
            setIsSpeaking(true);
            setAudioLevel(Math.min(100, Math.round((avg / 60) * 100)));
          } else {
            setIsSpeaking(false);
            setAudioLevel(0);
          }

          animFrameRef.current = requestAnimationFrame(checkVolume);
        };

        animFrameRef.current = requestAnimationFrame(checkVolume);
      } catch (err) {
        setHasMicPermission(false);
        setIsSpeaking(false);
        setAudioLevel(0);
      }
    }

    initMic();

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [isOnAir]);

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

  const respondToSpeaker = useCallback((listenerId, accepted) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'SPEAK_DECISION',
        frequency,
        listenerId,
        accepted,
      }));
      setSpeakerQueue((prev) => prev.filter((s) => s.listenerId !== listenerId));
    }
  }, [frequency]);

  return {
    isSpeaking,
    audioLevel,
    listenersCount,
    hasMicPermission,
    connectionStatus,
    chatMessages,
    floatingReactions,
    speakerQueue,
    sendChatMessage,
    sendReaction,
    respondToSpeaker,
  };
}
