import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Icosahedron } from '@react-three/drei';
import * as THREE from 'three';
import p5 from 'p5';
import './App.css';

// --- Global Audio Context ---
let audioContext: AudioContext;
let analyser: AnalyserNode;
let dataArray: Uint8Array;
let microphoneStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;

const initAudioContext = async () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  return { audioContext, analyser, dataArray };
};

// --- Three.js Glowing Orb Component ---
function AudioOrb({ isSpeaking }: { isSpeaking: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  // Create a base geometry to store original vertices
  const baseGeometry = useMemo(() => new THREE.IcosahedronGeometry(2, 16), []);
  const positionAttribute = baseGeometry.attributes.position;
  const vertex = new THREE.Vector3();

  const smoothedFreq = useRef(0);

  useFrame((state) => {
    if (!meshRef.current) return;

    const time = state.clock.elapsedTime;

    // Get real mic audio if available
    let rawFreq = 0;
    if (analyser && dataArray) {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      rawFreq = sum / dataArray.length;
    }

    // When speaking, use smooth sine breathing instead of random chaos
    if (isSpeaking) {
      rawFreq = 40 + Math.sin(time * 2.1) * 20 + Math.sin(time * 3.7) * 10;
    }

    // Lerp smoothly toward target (removes all jitter)
    smoothedFreq.current += (rawFreq - smoothedFreq.current) * 0.06;
    const freq = smoothedFreq.current;

    const scale = 1 + (freq / 256) * 0.45;
    meshRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.04);

    meshRef.current.rotation.y += 0.004;
    meshRef.current.rotation.x += 0.0015;

    // Smooth vertex distortion
    const geometry = meshRef.current.geometry as THREE.BufferGeometry;
    const positions = geometry.attributes.position;
    const distortionFactor = (freq / 256) * 0.35;

    for (let i = 0; i < positionAttribute.count; i++) {
      vertex.fromBufferAttribute(positionAttribute, i);
      const offset =
        Math.sin(vertex.x * 1.5 + time * 1.8) *
        Math.cos(vertex.y * 1.5 + time * 1.3) *
        distortionFactor;
      vertex.normalize().multiplyScalar(2 + offset);
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();

    if (materialRef.current) {
      const hue = 0.52 + Math.sin(time * 0.5) * 0.08;
      const lightness = 0.45 + (freq / 256) * 0.35;
      materialRef.current.emissive.setHSL(hue, 1, lightness);
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <icosahedronGeometry args={[2, 16]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#000000"
        emissive="#00f2fe"
        emissiveIntensity={1}
        wireframe={true}
        transparent={true}
        opacity={0.8}
      />
    </mesh>
  );
}

// --- p5.js Particle System Component ---
function P5Background({ isListening, isSpeaking }: { isListening: boolean, isSpeaking: boolean }) {
  const p5ContainerRef = useRef<HTMLDivElement>(null);
  const p5Instance = useRef<p5 | null>(null);

  useEffect(() => {
    if (!p5ContainerRef.current) return;

    const sketch = (p: p5) => {
      let particles: Particle[] = [];

      class Particle {
        x: number;
        y: number;
        vx: number;
        vy: number;
        size: number;
        color: p5.Color;

        constructor() {
          this.x = p.random(p.width);
          this.y = p.random(p.height);
          this.vx = p.random(-1, 1);
          this.vy = p.random(-1, 1);
          this.size = p.random(2, 5);
          this.color = p.color(0, p.random(150, 255), p.random(200, 255), p.random(50, 150));
        }

        update(audioIntensity: number) {
          this.x += this.vx * (1 + audioIntensity * 5);
          this.y += this.vy * (1 + audioIntensity * 5);

          if (this.x < 0) this.x = p.width;
          if (this.x > p.width) this.x = 0;
          if (this.y < 0) this.y = p.height;
          if (this.y > p.height) this.y = 0;
        }

        draw() {
          p.noStroke();
          p.fill(this.color);
          p.ellipse(this.x, this.y, this.size);
        }
      }

      p.setup = () => {
        const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
        canvas.position(0, 0);
        canvas.style('z-index', '-1');
        for (let i = 0; i < 100; i++) {
          particles.push(new Particle());
        }
      };

      p.draw = () => {
        p.clear();

        let audioIntensity = 0;
        if (analyser && dataArray) {
          analyser.getByteFrequencyData(dataArray);
          audioIntensity = dataArray[10] / 256; // grab a lower frequency band
        }

        if (isSpeaking) {
          audioIntensity = p.random(0.3, 0.8);
        }

        particles.forEach(particle => {
          particle.update(audioIntensity);
          particle.draw();
        });
      };

      p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
      };
    };

    p5Instance.current = new p5(sketch, p5ContainerRef.current);

    return () => {
      p5Instance.current?.remove();
    };
  }, [isSpeaking]);

  return <div ref={p5ContainerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />;
}

// --- Main App ---
function App() {
  const [input, setInput] = useState('');
  const [chatLog, setChatLog] = useState<{ user: string; bot: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = async () => {
        setIsListening(true);
        await initAudioContext();
        try {
          microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          sourceNode = audioContext.createMediaStreamSource(microphoneStream);
          sourceNode.connect(analyser);
        } catch (err) {
          console.error("Microphone access denied:", err);
        }
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInput(transcript);
          handleSendMessage(transcript);
        }
      };

      rec.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        stopMicrophone();
      };

      rec.onend = () => {
        stopMicrophone();
      };

      recognitionRef.current = rec;
    }
  }, []);

  const stopMicrophone = () => {
    setIsListening(false);
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
  }

  // Canvas-based waveform visualizer — smooth sine-wave breathing
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Persistent smoothed waveform buffer
    const NUM = 80;
    const current = new Float32Array(NUM).fill(0);
    let t = 0;

    let animFrame: number;
    const draw = () => {
      t += 0.025;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Build target samples
      const target = new Float32Array(NUM);

      if (analyser && dataArray && isListening) {
        // Real mic data
        analyser.getByteTimeDomainData(dataArray);
        const step = Math.floor(dataArray.length / NUM);
        for (let i = 0; i < NUM; i++) {
          target[i] = (dataArray[i * step] / 128) - 1;
        }
      } else if (isSpeaking) {
        // Smooth sine-wave breathing — 3 overlapping waves
        for (let i = 0; i < NUM; i++) {
          const x = i / NUM;
          target[i] =
            Math.sin(x * Math.PI * 4 + t * 2.0) * 0.35 +
            Math.sin(x * Math.PI * 7 + t * 3.1) * 0.20 +
            Math.sin(x * Math.PI * 2 + t * 1.2) * 0.15;
        }
      }
      // else: zeros → flat line

      // Lerp current toward target for buttery smoothness
      const lerpSpeed = isListening ? 0.4 : 0.08;
      for (let i = 0; i < NUM; i++) {
        current[i] += (target[i] - current[i]) * lerpSpeed;
      }

      // Draw
      const sliceW = W / (NUM - 1);
      const gradient = ctx.createLinearGradient(0, 0, W, 0);
      gradient.addColorStop(0, 'rgba(79,172,254,0.6)');
      gradient.addColorStop(0.5, 'rgba(0,242,254,1)');
      gradient.addColorStop(1, 'rgba(79,172,254,0.6)');

      ctx.beginPath();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 12;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (let i = 0; i < NUM; i++) {
        const x = i * sliceW;
        const y = H / 2 + current[i] * (H / 2 - 6);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      animFrame = requestAnimationFrame(draw);
    };

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, [isSpeaking, isListening]);

  useEffect(() => {
    if (isMuted) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [isMuted]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // ── Cartesia TTS ──────────────────────────────────────────────────────────
  // Keys are read from .env (never commit .env to git!)
  const CARTESIA_API_KEY = import.meta.env.VITE_CARTESIA_API_KEY || '';
  const CARTESIA_VOICE_ID = import.meta.env.VITE_CARTESIA_VOICE_ID || 'ee7ea9f8-c0c1-498c-9279-764d6b56d189';

  // Converts raw text to natural spoken language before TTS
  const prepareForSpeech = (text: string): string => {
    return text
      .replace(/[*#`_\[\]]/g, '')
      .replace(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g, 'this email address')
      .replace(/\+?[\d][\d\s\-().]{7,}/g, 'this number')
      .replace(/https?:\/\/\S+/g, 'the link shown on screen')
      .trim();
  };

  const speakText = async (text: string) => {
    if (isMuted) return;
    window.speechSynthesis.cancel();

    const cleanText = prepareForSpeech(text);
    if (!cleanText) return;

    try {
      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'X-API-Key': CARTESIA_API_KEY,
          'Cartesia-Version': '2024-06-10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: cleanText,
          model_id: 'sonic-2',
          voice: {
            mode: 'id',
            id: CARTESIA_VOICE_ID,
          },
          output_format: {
            container: 'mp3',
            encoding: 'mp3',
            sample_rate: 44100,
          },
          language: 'en',
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('🔴 Cartesia error:', response.status, errText);
        throw new Error(`Cartesia ${response.status}: ${errText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      // ✅ Sync animation to actual audio playback — not to network request start
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = (e) => { console.error('Audio error:', e); setIsSpeaking(false); URL.revokeObjectURL(url); };
      await audio.play();

    } catch (err) {
      console.error('🔴 Cartesia TTS failed, using browser fallback:', err);
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find(v => v.name.includes('Daniel')) ||
        voices.find(v => v.name.includes('George')) ||
        voices.find(v => v.lang === 'en-GB') ||
        voices.find(v => v.lang.startsWith('en'));
      if (preferredVoice) utterance.voice = preferredVoice;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }
  };


  const handleSendMessage = async (textToSend?: string) => {
    const msgText = textToSend || input;
    if (!msgText.trim()) return;

    setInput('');
    setLoading(true);
    window.speechSynthesis.cancel();
    setIsSpeaking(false);

    setChatLog((prev) => [...prev, { user: msgText, bot: '...' }]);

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText }),
      });
      const data = await response.json();

      setChatLog((prev) => {
        const newLog = [...prev];
        newLog[newLog.length - 1].bot = data.reply;
        return newLog;
      });

      speakText(data.reply);
    } catch (error) {
      console.error('Error sending message:', error);
      const fallbackReply = "I am currently offline, but you can email me to get in touch!";
      setChatLog((prev) => {
        const newLog = [...prev];
        newLog[newLog.length - 1].bot = fallbackReply;
        return newLog;
      });
      speakText(fallbackReply);
    } finally {
      setLoading(false);
    }
  };

  const toggleListen = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog, loading]);

  return (
    <div className="app-container">
      {/* Left Viewport (3D Orb + p5 Particles) */}
      <div className="viewport-container">

        {/* p5.js Background Particles (z-index 1) */}
        <P5Background isListening={isListening} isSpeaking={isSpeaking} />

        {/* Three.js Glowing Orb (z-index 2) */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2 }}>
          <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1} color="#00f2fe" />
            <pointLight position={[-10, -10, -10]} intensity={0.5} color="#4facfe" />
            <AudioOrb isSpeaking={isSpeaking} />
            <OrbitControls enableZoom={false} enablePan={false} autoRotate={true} autoRotateSpeed={0.5} />
          </Canvas>
        </div>

        <div className="viewport-overlay" />

        <div className="brand-badge">
          <div className="brand-dot" />
          Hazem AI Agent
        </div>

        <div className="viewport-hint">
          {isListening ? "Listening to your voice..." : "Click microphone to speak"}
        </div>

        {/* Canvas Waveform Visualizer */}
        <canvas
          ref={waveCanvasRef}
          width={600}
          height={60}
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '10%',
            right: '10%',
            width: '80%',
            zIndex: 10,
            opacity: isListening || isSpeaking ? 1 : 0.15,
            transition: 'opacity 0.4s ease',
          }}
        />
      </div>

      {/* Right Chat Interface */}
      <div className="chat-container">
        <div className="chat-header">
          <div className="chat-header-content">
            <div className="chat-avatar-icon">🧠</div>
            <div>
              <h2>Intelligent Assistant</h2>
              <p className="chat-subtitle">Powered by Llama-3.2</p>
            </div>
          </div>
          <div className="header-controls">
            <button
              className={`mute-button ${isMuted ? 'muted' : ''}`}
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? "Unmute Voice" : "Mute Voice"}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <div className="status-badge">
              <div className="status-dot" />
              Online
            </div>
          </div>
        </div>

        <div className="chat-messages">
          {chatLog.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🤖</div>
              <h3>Welcome to my Portfolio</h3>
              <p>Ask me anything about my experience, skills, or projects.</p>
              <div className="suggestion-chips">
                <button className="chip" onClick={() => handleSendMessage("Who are you?")}>Who are you?</button>
                <button className="chip" onClick={() => handleSendMessage("What are your skills?")}>Technical Skills</button>
                <button className="chip" onClick={() => handleSendMessage("Tell me about your projects")}>Projects</button>
              </div>
            </div>
          ) : (
            chatLog.map((msg, idx) => (
              <div key={idx} className="message">
                <div className="message-user">
                  <div className="avatar-icon">👤</div>
                  <div className="message-bubble user-bubble">{msg.user}</div>
                </div>
                <div className="message-bot">
                  <div className="avatar-icon">🧠</div>
                  <div className="message-bubble bot-bubble">
                    {msg.bot === '...' ? (
                      <div className="typing-dots">
                        <span></span><span></span><span></span>
                      </div>
                    ) : (
                      msg.bot
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="chat-input-container">
          <button
            className={`mic-button ${isListening ? 'listening' : ''}`}
            onClick={toggleListen}
            title="Use Microphone"
          >
            🎤
          </button>
          <input
            type="text"
            className={`chat-input ${isListening ? 'listening' : ''}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={isListening ? "Listening..." : "Type your message..."}
            disabled={loading}
          />
          <button
            className="send-button"
            onClick={() => handleSendMessage()}
            disabled={!input.trim() || loading}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;