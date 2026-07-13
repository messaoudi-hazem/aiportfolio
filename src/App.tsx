import { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import p5 from 'p5';
import './App.css';

// ── Audio globals ─────────────────────────────────────────
let audioContext: AudioContext;
let analyser: AnalyserNode;
let dataArray: Uint8Array<ArrayBuffer>;
let microphoneStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;

const initAudioContext = async () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }
  if (audioContext.state === 'suspended') await audioContext.resume();
};

// ── Mobile audio unlock ───────────────────────────────────
// iOS/Android block audio.play() unless triggered by a user gesture.
// We create a silent AudioContext on first tap/click to unlock the audio system.
let audioUnlocked = false;
const unlockAudio = () => {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    // Also play + immediately pause a real Audio element to unlock HTMLAudioElement
    const a = new Audio();
    a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAVFYAAFRWAAABAAgAZGF0YQAAAAA=';
    a.play().then(() => a.pause()).catch(() => {});
    setTimeout(() => ctx.close(), 500);
  } catch {}
};

// ── Orb ──────────────────────────────────────────────────
function AudioOrb({ isSpeaking, isListening }: { isSpeaking: boolean; isListening: boolean }) {
  const meshRef     = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const base        = useMemo(() => new THREE.IcosahedronGeometry(2, 16), []);
  const vertex      = new THREE.Vector3();
  const smoothed    = useRef(0);

  useFrame(({ clock, camera, size }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;

    // Shrink orb on narrow screens so it never overflows
    const isMobile = size.width < 700;
    const targetFov = isMobile ? 55 : 45;
    if ((camera as THREE.PerspectiveCamera).fov !== targetFov) {
      (camera as THREE.PerspectiveCamera).fov = targetFov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }

    let raw = 0;
    if (analyser && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      let s = 0;
      for (let i = 0; i < dataArray.length; i++) s += dataArray[i];
      raw = s / dataArray.length;
    }
    if (isSpeaking) raw = 40 + Math.sin(t * 2.1) * 20 + Math.sin(t * 3.7) * 10;

    smoothed.current += (raw - smoothed.current) * 0.06;
    const freq = smoothed.current;

    const sc = 1 + (freq / 256) * 0.45;
    meshRef.current.scale.lerp(new THREE.Vector3(sc, sc, sc), 0.04);
    meshRef.current.rotation.y += 0.004;
    meshRef.current.rotation.x += 0.0015;

    const pos = (meshRef.current.geometry as THREE.BufferGeometry).attributes.position;
    const d   = (freq / 256) * 0.35;
    for (let i = 0; i < base.attributes.position.count; i++) {
      vertex.fromBufferAttribute(base.attributes.position, i);
      const off = Math.sin(vertex.x * 1.5 + t * 1.8) * Math.cos(vertex.y * 1.5 + t * 1.3) * d;
      vertex.normalize().multiplyScalar(2 + off);
      pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    pos.needsUpdate = true;
    (meshRef.current.geometry as THREE.BufferGeometry).computeVertexNormals();

    if (materialRef.current) {
      const hue = isListening ? 0.72 + Math.sin(t * 0.8) * 0.05 : 0.52 + Math.sin(t * 0.5) * 0.08;
      materialRef.current.emissive.setHSL(hue, 1, 0.45 + (freq / 256) * 0.35);
      materialRef.current.emissiveIntensity = isListening ? 1.4 : 1;
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[2, 16]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#000000"
        emissive="#38bdf8"
        emissiveIntensity={1}
        wireframe transparent opacity={0.85}
      />
    </mesh>
  );
}

// ── Particles ─────────────────────────────────────────────
function P5Background({ isSpeaking }: { isSpeaking: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Ref        = useRef<p5 | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const sketch = (p: p5) => {
      const pts: Particle[] = [];
      class Particle {
        x = p.random(p.width); y = p.random(p.height);
        vx = p.random(-1, 1);  vy = p.random(-1, 1);
        sz = p.random(2, 5);
        c  = p.color(0, p.random(150, 255), p.random(200, 255), p.random(50, 150));
        update(n: number) {
          this.x += this.vx * (1 + n * 5); this.y += this.vy * (1 + n * 5);
          if (this.x < 0) this.x = p.width;  if (this.x > p.width)  this.x = 0;
          if (this.y < 0) this.y = p.height; if (this.y > p.height) this.y = 0;
        }
        draw() { p.noStroke(); p.fill(this.c); p.ellipse(this.x, this.y, this.sz); }
      }
      p.setup = () => {
        const c = p.createCanvas(p.windowWidth, p.windowHeight);
        c.position(0, 0); c.style('z-index', '-1');
        for (let i = 0; i < 100; i++) pts.push(new Particle());
      };
      p.draw = () => {
        p.clear();
        let n = analyser && dataArray ? dataArray[10] / 256 : 0;
        if (isSpeaking) n = p.random(0.3, 0.8);
        pts.forEach(pt => { pt.update(n); pt.draw(); });
      };
      p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
    };
    p5Ref.current = new p5(sketch, containerRef.current);
    return () => { p5Ref.current?.remove(); };
  }, [isSpeaking]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }} />;
}

// ── Icons ─────────────────────────────────────────────────
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
}
function VolumeIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  );
}

// ── Message type ──────────────────────────────────────────
interface Message {
  id: number;
  role: 'user' | 'bot';
  text: string;
  fading: boolean;
  hovered: boolean;
}

// ── Contact-info extractor ────────────────────────────────
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?[\d][\d\s\-().]{6,}\d/g;

function extractContactInfo(text: string): string | null {
  const emails = text.match(EMAIL_RE) || [];
  const phones = text.match(PHONE_RE) || [];
  if (!emails.length && !phones.length) return null;
  const parts: string[] = [];
  if (emails.length) parts.push('✉ ' + emails[0]);
  if (phones.length) parts.push('📞 ' + phones[0]!.trim());
  return parts.join('   ');
}

// ── App ───────────────────────────────────────────────────
export default function App() {
  const [input,       setInput]       = useState('');
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking,  setIsSpeaking]  = useState(false);
  const [isMuted,     setIsMuted]     = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [pinnedContact, setPinnedContact] = useState<string | null>(null);

  const idRef          = useRef(0);
  const recognitionRef    = useRef<any>(null);
  const handleSendMsgRef  = useRef<(override?: string) => void>(() => {});
  const waveCanvasRef  = useRef<HTMLCanvasElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  // currently playing Cartesia audio — killed before starting a new one
  const activeAudioRef    = useRef<HTMLAudioElement | null>(null);
  const activeMediaSrcRef = useRef<MediaSource | null>(null);
  // id of the bot message currently showing (so we can fade it when interrupted)
  const activeBotMsgIdRef = useRef<number>(-1);
  // Pre-created audio element — created during user gesture so mobile allows play()
  const warmAudioRef      = useRef<HTMLAudioElement | null>(null);
  // tracks active fade timers so hover can cancel/resume them
  const fadeTimers     = useRef<Map<number, { fadeId: ReturnType<typeof setTimeout>, removeId: ReturnType<typeof setTimeout> }>>(new Map());

  // keep canvas pixel width in sync with viewport
  useEffect(() => {
    const canvas = waveCanvasRef.current; if (!canvas) return;
    const sync = () => { canvas.width = window.innerWidth; };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  // On mobile, when the keyboard opens the visual viewport shrinks.
  // Anchor the left-panel to the visual viewport bottom so it stays above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const panel = document.querySelector('.left-panel') as HTMLElement | null;
    const wave  = document.querySelector('.waveform-canvas') as HTMLElement | null;
    const onResize = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      if (panel) panel.style.bottom = offset > 0 ? `${offset}px` : '';
      if (wave)  wave.style.bottom  = offset > 0 ? `${offset + 70}px` : '';
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); };
  }, []);

  // hide hint after first interaction
  const hideHint = () => setHintVisible(false);

  // Schedule fade-out for a message after 8s (skipped if hovered)
  const scheduleFade = (id: number) => {
    const fadeId = setTimeout(() => {
      // Only fade if not currently hovered
      setMessages(prev => {
        const msg = prev.find(m => m.id === id);
        if (msg?.hovered) return prev; // skip — hovered, will reschedule on mouseout
        return prev.map(m => m.id === id ? { ...m, fading: true } : m);
      });
      const removeId = setTimeout(() => {
        setMessages(prev => prev.filter(m => m.id !== id));
        fadeTimers.current.delete(id);
      }, 1500);
      fadeTimers.current.set(id, { ...fadeTimers.current.get(id)!, removeId });
    }, 8000);
    fadeTimers.current.set(id, { fadeId, removeId: 0 as any });
  };

  // Push a user message immediately with auto-fade
  const pushUserMessage = (text: string) => {
    const id = ++idRef.current;
    setMessages(prev => [...prev, { id, role: 'user', text, fading: false, hovered: false }]);
    scheduleFade(id);
  };

  // Show a bot message (called when TTS starts playing)
  const showBotMessage = (text: string) => {
    const id = ++idRef.current;
    setMessages(prev => [...prev, { id, role: 'bot', text, fading: false, hovered: false }]);
    // Pin contact info if present
    const info = extractContactInfo(text);
    if (info) setPinnedContact(prev => prev ?? info);
    return id;
  };

  // Fade a bot message out (called when TTS ends)
  const fadeBotMessage = (id: number) => {
    setMessages(prev => {
      const msg = prev.find(m => m.id === id);
      if (msg?.hovered) {
        // Hovered — mark as pending-fade so mouseout will trigger it
        return prev.map(m => m.id === id ? { ...m, fading: false } : m);
      }
      return prev.map(m => m.id === id ? { ...m, fading: true } : m);
    });
    const removeId = setTimeout(() => {
      setMessages(prev => {
        const msg = prev.find(m => m.id === id);
        if (msg?.hovered) return prev; // still hovered, don't remove
        return prev.filter(m => m.id !== id);
      });
    }, 1500);
    fadeTimers.current.set(id, { fadeId: 0 as any, removeId });
  };

  // Hover handlers — pause fade while hovering, resume on leave
  const onMsgMouseEnter = (id: number) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, hovered: true, fading: false } : m));
    // Cancel any pending timers
    const timers = fadeTimers.current.get(id);
    if (timers) {
      clearTimeout(timers.fadeId);
      clearTimeout(timers.removeId);
    }
  };

  const onMsgMouseLeave = (id: number) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, hovered: false } : m));
    // Restart fade after 2s grace period
    const timers = fadeTimers.current.get(id);
    if (timers) {
      const fadeId = setTimeout(() => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, fading: true } : m));
        const removeId = setTimeout(() => {
          setMessages(prev => prev.filter(m => m.id !== id));
          fadeTimers.current.delete(id);
        }, 1500);
        fadeTimers.current.set(id, { ...fadeTimers.current.get(id)!, removeId });
      }, 2000);
      fadeTimers.current.set(id, { ...timers, fadeId });
    }
  };

  // Speech recognition
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = false; rec.interimResults = false; rec.lang = 'en-US';

    rec.onstart = async () => {
      setIsListening(true);
      hideHint();
      await initAudioContext();
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        sourceNode = audioContext.createMediaStreamSource(microphoneStream);
        sourceNode.connect(analyser);
      } catch (e) { console.error(e); }
    };

    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript?.trim();
      if (!transcript) return;
      // Stop mic FIRST (releases resources), THEN send the message
      stopMic();
      // Small delay so state updates from stopMic flush before handleSendMessage reads them
      setTimeout(() => handleSendMsgRef.current(transcript), 50);
    };

    // onerror: stop mic, don't send anything
    rec.onerror = (e: any) => {
      console.warn('Speech recognition error:', e.error);
      stopMic();
    };

    // onend fires after onresult on mobile — only stop mic if not already stopped
    rec.onend = () => {
      setIsListening(false);
      // Don't call stopMic() here — onresult already did it, or onerror did
    };

    recognitionRef.current = rec;
  }, []);

  const stopMic = () => {
    setIsListening(false);
    microphoneStream?.getTracks().forEach(t => t.stop());
    microphoneStream = null;
    if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
  };

  const toggleListen = () => {
    if (isListening) recognitionRef.current?.stop();
    else             recognitionRef.current?.start();
  };

  // Waveform
  useEffect(() => {
    const canvas = waveCanvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const N = 80; const cur = new Float32Array(N); let t = 0; let raf: number;
    const draw = () => {
      t += 0.025; ctx.clearRect(0, 0, canvas.width, canvas.height);
      const tgt = new Float32Array(N);
      if (analyser && dataArray && isListening) {
        analyser.getByteTimeDomainData(dataArray);
        const step = Math.floor(dataArray.length / N);
        for (let i = 0; i < N; i++) tgt[i] = (dataArray[i * step] / 128) - 1;
      } else if (isSpeaking) {
        for (let i = 0; i < N; i++) {
          const x = i / N;
          tgt[i] = Math.sin(x * Math.PI * 4 + t * 2) * 0.35
                 + Math.sin(x * Math.PI * 7 + t * 3.1) * 0.2
                 + Math.sin(x * Math.PI * 2 + t * 1.2) * 0.15;
        }
      }
      const sp = isListening ? 0.4 : 0.08;
      for (let i = 0; i < N; i++) cur[i] += (tgt[i] - cur[i]) * sp;
      const W = canvas.width, H = canvas.height;
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(59,130,246,0.5)');
      g.addColorStop(0.5, 'rgba(56,189,248,0.9)');
      g.addColorStop(1, 'rgba(139,92,246,0.5)');
      ctx.beginPath(); ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 10;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (let i = 0; i < N; i++) {
        const x = i * (W / (N - 1)), y = H / 2 + cur[i] * (H / 2 - 4);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke(); raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [isSpeaking, isListening]);

  useEffect(() => {
    if (isMuted) {
      if (activeAudioRef.current) {
        activeAudioRef.current.onplay  = null;
        activeAudioRef.current.onended = null;
        activeAudioRef.current.onerror = null;
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      setIsSpeaking(false);
    }
  }, [isMuted]);
  useEffect(() => () => {
    // cleanup on unmount
    if (activeAudioRef.current) { activeAudioRef.current.pause(); activeAudioRef.current = null; }
  }, []);

  // TTS
  const CARTESIA_KEY     = import.meta.env.VITE_CARTESIA_API_KEY  || '';
  const CARTESIA_VOICE   = import.meta.env.VITE_CARTESIA_VOICE_ID || 'ef191366-f52f-447a-a398-ed8c0f2943a1';
  const prepareForSpeech = (t: string) =>
    t.replace(/[*#`_[\]]/g, '').replace(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g, 'this email')
     .replace(/\+?[\d][\d\s\-().]{7,}/g, 'this number').replace(/https?:\/\/\S+/g, 'the link').trim();

  // Detect iOS Safari — MediaSource streaming doesn't work there
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const speakText = async (text: string, botMsgText: string) => {
    // ── Kill any currently playing audio + dismiss its message ─
    if (activeAudioRef.current) {
      activeAudioRef.current.onplay  = null;
      activeAudioRef.current.onended = null;
      activeAudioRef.current.onerror = null;
      activeAudioRef.current.pause();
      URL.revokeObjectURL(activeAudioRef.current.src);
      activeAudioRef.current = null;
    }
    if (activeMediaSrcRef.current) {
      try { if (activeMediaSrcRef.current.readyState === 'open') activeMediaSrcRef.current.endOfStream(); } catch {}
      activeMediaSrcRef.current = null;
    }
    // Immediately fade + remove the old bot message that was interrupted
    if (activeBotMsgIdRef.current !== -1) {
      const oldId = activeBotMsgIdRef.current;
      activeBotMsgIdRef.current = -1;
      // Hard-remove it instantly (no fade delay — it's being replaced)
      setMessages(prev => prev.filter(m => m.id !== oldId));
    }
    setIsSpeaking(false);

    if (isMuted) {
      // Muted: show the message immediately and fade normally
      const id = showBotMessage(botMsgText);
      scheduleFade(id);
      return;
    }

    const clean = prepareForSpeech(text); if (!clean) return;

    // Bot message id — set when voice actually starts
    let botMsgId = -1;

    const onVoiceStart = () => {
      setIsSpeaking(true);
      const id = showBotMessage(botMsgText);
      botMsgId = id;
      activeBotMsgIdRef.current = id;
    };
    const onVoiceEnd = () => {
      setIsSpeaking(false);
      activeBotMsgIdRef.current = -1;
      if (botMsgId !== -1) fadeBotMessage(botMsgId);
    };

    try {
      const res = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'X-API-Key': CARTESIA_KEY,
          'Cartesia-Version': '2024-06-10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: clean,
          model_id: 'sonic-2',
          voice: { mode: 'id', id: CARTESIA_VOICE },
          output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100 },
          language: 'en',
          stream: true,
        }),
      });

      if (!res.ok || !res.body) throw new Error(await res.text());

      const mime = 'audio/mpeg';

      // ── iOS / no MediaSource: download blob, play via pre-warmed Audio element ──
      if (isIOS || !MediaSource.isTypeSupported(mime)) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        // Reuse the pre-created audio element if available (gesture-unlocked on mobile)
        const audio = warmAudioRef.current ?? new Audio();
        warmAudioRef.current = null; // consume it
        audio.src = url;
        activeAudioRef.current = audio;
        audio.onplay  = onVoiceStart;
        audio.onended = () => {
          onVoiceEnd(); URL.revokeObjectURL(url);
          activeAudioRef.current = null; activeBotMsgIdRef.current = -1;
        };
        audio.onerror = () => {
          onVoiceEnd(); URL.revokeObjectURL(url);
          activeAudioRef.current = null; activeBotMsgIdRef.current = -1;
        };
        const playPromise = audio.play();
        if (playPromise) playPromise.catch((err) => {
          console.warn('Audio play blocked:', err);
          // Show message silently if audio is blocked
          onVoiceStart();
          setTimeout(onVoiceEnd, 8000);
        });
        return;
      }

      // ── Other browsers: stream via MediaSource for low latency ──
      const ms    = new MediaSource();
      const audio = new Audio();
      audio.src   = URL.createObjectURL(ms);

      await new Promise<void>((resolve) => {
        ms.addEventListener('sourceopen', () => resolve(), { once: true });
        audio.load();
      });

      const sb = ms.addSourceBuffer(mime);

      // Register so a new request can kill this audio immediately
      activeAudioRef.current    = audio;
      activeMediaSrcRef.current = ms;

      audio.onplay  = onVoiceStart;
      audio.onended = () => {
        onVoiceEnd();
        URL.revokeObjectURL(audio.src);
        if (ms.readyState === 'open') ms.endOfStream();
        activeAudioRef.current    = null;
        activeMediaSrcRef.current = null;
        activeBotMsgIdRef.current = -1;
      };
      audio.onerror = () => {
        onVoiceEnd();
        URL.revokeObjectURL(audio.src);
        activeAudioRef.current    = null;
        activeMediaSrcRef.current = null;
        activeBotMsgIdRef.current = -1;
      };

      audio.play().catch(() => {});

      const reader  = res.body.getReader();
      const queue: Uint8Array[] = [];
      let appending = false;

      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const waitDone = () => new Promise<void>(r => {
              if (!sb.updating) { r(); return; }
              sb.addEventListener('updateend', () => r(), { once: true });
            });
            await waitDone();
            if (ms.readyState === 'open') ms.endOfStream();
            break;
          }
          queue.push(value);
          if (!appending) appendNext();
        }
      };

      const appendNext = () => {
        if (!queue.length || sb.updating) return;
        appending = true;
        const chunk = queue.shift()!;
        try { sb.appendBuffer(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer); } catch { appending = false; return; }
        sb.addEventListener('updateend', () => { appending = false; appendNext(); }, { once: true });
      };

      pump();

    } catch {
      // Cartesia failed — show the message silently without audio
      onVoiceStart();
      setTimeout(onVoiceEnd, 8000); // auto-dismiss after 8s
    }
  };

  const handleSendMessage = async (override?: string) => {
    const msg = (override ?? input).trim(); if (!msg) return;
    setInput(''); setLoading(true);
    pushUserMessage(msg);

    try {
      const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const res  = await fetch(`${API}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
      const data = await res.json();
      speakText(data.reply, data.reply);
    } catch {
      const fb = 'I am currently offline, but you can email me to get in touch.';
      speakText(fb, fb);
    } finally { setLoading(false); }
  };
  // Keep ref always pointing to latest version so speech recognition can call it
  handleSendMsgRef.current = handleSendMessage;

  return (
    <div className="app-container">

      {/* Full-screen orb stage */}
      <P5Background isSpeaking={isSpeaking} />

      <div
        className={`orb-wrapper ${isListening ? 'orb-listening' : ''}`}
        onClick={() => {
          unlockAudio();
          // Pre-create audio element inside gesture so mobile allows play() later
          if (!warmAudioRef.current) warmAudioRef.current = new Audio();
          toggleListen();
        }}
        role="button"
        aria-label={isListening ? 'Stop listening' : 'Speak'}
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && toggleListen()}
      >
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]}   intensity={1}   color="#38bdf8" />
          <pointLight position={[-10, -10, -10]} intensity={0.5} color="#3b82f6" />
          <AudioOrb isSpeaking={isSpeaking} isListening={isListening} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.5} />
        </Canvas>
      </div>

      {/* Vignette */}
      <div className="vignette" />

      {/* Corner brackets */}
      <div className="corner-brackets" />

      {/* Header strip */}
      <header className="app-header">
        <div>
          <div className="app-title">Mssaoudi Hazem Agent</div>
          <div className="app-sub">My ai  &amp; interview</div>
        </div>
        <button className={`icon-btn ${isMuted ? 'muted' : ''}`} onClick={() => setIsMuted(m => !m)} title={isMuted ? 'Unmute' : 'Mute'}>
          <VolumeIcon muted={isMuted} />
        </button>
      </header>

      {/* ── Full-width waveform — outside left panel ────────── */}
      <canvas
        ref={waveCanvasRef}
        height={48}
        className={`waveform-canvas ${isListening || isSpeaking ? 'active' : ''}`}
      />

      {/* ── Left panel: pinned card + chat + input ───────────── */}
      <div className="left-panel">

        {/* Pinned contact card — set once, never duplicated */}
        {pinnedContact && (
          <div className="pinned-contact fade-in">
            <span className="pin-icon">📌</span>
            <div className="pin-body">
              <span className="pin-label">Contact Info</span>
              <span className="pin-text">{pinnedContact}</span>
            </div>
            <button className="pin-close" onClick={() => setPinnedContact(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Chat messages */}
        <div className="subtitle-stage">
          {messages.length === 0 && hintVisible && (
            <div className="subtitle-hint">
              Tap the orb to speak, or type below
            </div>
          )}

          {messages.map(m => (
            <div
              key={m.id}
              className={`subtitle-msg ${m.role} ${m.fading ? 'fade-out' : 'fade-in'}`}
              onMouseEnter={() => onMsgMouseEnter(m.id)}
              onMouseLeave={() => onMsgMouseLeave(m.id)}
              onTouchStart={() => onMsgMouseEnter(m.id)}
              onTouchEnd={() => onMsgMouseLeave(m.id)}
            >
              {m.role === 'user'
                ? <span className="sub-label user-label">You</span>
                : <span className="sub-label bot-label">AI</span>}
              <span className="sub-text">{m.text}</span>
            </div>
          ))}

          {loading && (
            <div className="subtitle-msg bot fade-in">
              <span className="sub-label bot-label">AI</span>
              <span className="sub-text">
                <span className="typing-dots"><span /><span /><span /></span>
              </span>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="input-bar">
          <input
            ref={inputRef}
            type="text"
            className="text-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { hideHint(); handleSendMessage(); } }}
            onFocus={() => {
              unlockAudio();
              if (!warmAudioRef.current) warmAudioRef.current = new Audio();
              hideHint();
            }}
            placeholder={isListening ? 'Listening...' : 'Type a message...'}
            disabled={loading}
          />
          <button className="icon-btn send-btn" onClick={() => { unlockAudio(); if (!warmAudioRef.current) warmAudioRef.current = new Audio(); hideHint(); handleSendMessage(); }} disabled={!input.trim() || loading} title="Send">
            <SendIcon />
          </button>
        </div>

      </div>

    </div>
  );
}
