import { useState, useEffect, useRef } from 'react';

/**
 * useBroadcastAudio
 * Manages local microphone capture, FFT speech detection, and audio level metering.
 *
 * Rules:
 * 1. When mic is muted: audio track is disabled, isSpeaking = false, level = 0.
 * 2. When mic is open and silent: isSpeaking = false, level = 0, waveform stays stable.
 * 3. When mic is open and above speech threshold: isSpeaking = true, level = 10..100.
 * 4. Syncs state across local browser tabs via BroadcastChannel.
 */
export function useBroadcastAudio(isOnAir, isMuted) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasMicPermission, setHasMicPermission] = useState(null);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const channelRef = useRef(null);

  useEffect(() => {
    try {
      const channel = new BroadcastChannel('live_voice_rooms_audio_sync');
      channelRef.current = channel;
      return () => {
        channel.close();
      };
    } catch {}
  }, []);

  useEffect(() => {
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'AUDIO_STATE',
        isOnAir,
        isMuted,
        isSpeaking,
        audioLevel,
      });
    }
  }, [isOnAir, isMuted, isSpeaking, audioLevel]);

  useEffect(() => {
    if (!isOnAir) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      setIsSpeaking(false);
      setAudioLevel(0);
      return;
    }

    let active = true;

    async function initAudio() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setHasMicPermission(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        setHasMicPermission(true);

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkVolume = () => {
          if (!active) return;

          if (isMuted) {
            setIsSpeaking(false);
            setAudioLevel(0);
            animFrameRef.current = requestAnimationFrame(checkVolume);
            return;
          }

          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const SPEAKING_THRESHOLD = 14;

          if (avg > SPEAKING_THRESHOLD) {
            setIsSpeaking(true);
            setAudioLevel(Math.min(100, Math.round((avg / 80) * 100)));
          } else {
            setIsSpeaking(false);
            setAudioLevel(0);
          }

          animFrameRef.current = requestAnimationFrame(checkVolume);
        };

        animFrameRef.current = requestAnimationFrame(checkVolume);
      } catch (err) {
        console.warn('[useBroadcastAudio] Microphone access unavailable:', err.message);
        setHasMicPermission(false);
        setIsSpeaking(false);
        setAudioLevel(0);
      }
    }

    initAudio();

    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [isOnAir, isMuted]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

  return {
    isSpeaking,
    audioLevel,
    hasMicPermission,
  };
}
