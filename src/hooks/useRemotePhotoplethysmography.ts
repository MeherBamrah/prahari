// useRemotePhotoplethysmography.ts — Heartbeat detection via skin color analysis
// Detects pulse from RGB color changes in face region over time

import { useState, useRef } from 'react';

export interface rPPGResult {
  heartbeatDetected: boolean;    // Pulse found in valid range
  pulseFrequency: number;        // BPM (beats per minute)
  confidence: number;            // 0-1 (signal quality)
  isValid: boolean;              // 60-120 BPM range
  signalStrength: number;        // 0-1 (clarity of pulse signal)
  failureReason?: string;
}

export interface UseRemotePhotoplethysmographyState {
  ready: boolean;
  error: string | null;
  loading: boolean;
  addFrame: (imageData: Uint8ClampedArray, landmarks: any[]) => void;
  getResult: () => rPPGResult | null;
  isRecording: boolean;
  frameCount: number;
  reset: () => void;
}

const MIN_FRAMES = 30;              // Minimum frames for analysis (~1 sec at 30fps)
const WINDOW_SIZE = 150;           // Keep 150 frames (~5 sec buffer)
const MIN_FREQUENCY = 0.7;         // 42 BPM (0.7 Hz)
const MAX_FREQUENCY = 2.0;         // 120 BPM (2.0 Hz)
const FPS = 30;                    // Expected frame rate

export function useRemotePhotoplethysmography(): UseRemotePhotoplethysmographyState {
  const [ready] = useState(true);
  const [error] = useState<string | null>(null);
  const [loading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);

  const rgbSignalRef = useRef<{ r: number[]; g: number[]; b: number[] }>({
    r: [],
    g: [],
    b: [],
  });
  const timestampsRef = useRef<number[]>([]);

  // Extract skin pixels from face region and compute average color
  const extractSkinColor = (
    imageData: Uint8ClampedArray,
    landmarks: any[]
  ): { r: number; g: number; b: number } | null => {
    try {
      if (!landmarks || landmarks.length === 0) return null;

      // Use cheek region (landmarks 50 and 280 are cheeks)
      const cheeks = [landmarks[50], landmarks[280]];
      
      let r = 0, g = 0, b = 0, count = 0;

      // Average pixels around each cheek landmark
      for (const cheek of cheeks) {
        if (!cheek) continue;

        // Rough canvas dimensions (assumes typical mobile video)
        const x = Math.floor(cheek.x * 480); // Assume 480px width
        const y = Math.floor(cheek.y * 640); // Assume 640px height
        const radius = 20; // 20px radius around landmark

        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            const px = x + dx;
            const py = y + dy;
            
            if (px < 0 || px >= 480 || py < 0 || py >= 640) continue;

            const idx = (py * 480 + px) * 4;
            const pixelR = imageData[idx];
            const pixelG = imageData[idx + 1];
            const pixelB = imageData[idx + 2];
            const alpha = imageData[idx + 3];

            // Only count non-transparent pixels
            if (alpha > 128) {
              r += pixelR;
              g += pixelG;
              b += pixelB;
              count++;
            }
          }
        }
      }

      if (count === 0) return null;

      return {
        r: r / count,
        g: g / count,
        b: b / count,
      };
    } catch (err) {
      console.error('useRemotePhotoplethysmography.extractSkinColor:', err);
      return null;
    }
  };

  // Normalize signal to zero-mean
  const normalize = (signal: number[]): number[] => {
    if (signal.length === 0) return [];

    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance =
      signal.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / signal.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return signal.map(() => 0);

    return signal.map((x) => (x - mean) / stdDev);
  };

  // Goertzel algorithm: efficient single-frequency DFT
  const goertzelMagnitude = (signal: number[], frequency: number, sampleRate: number): number => {
    const N = signal.length;
    const k = (frequency * N) / sampleRate;
    const w = (2 * Math.PI * k) / N;
    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const alpha = 2 * cosW;

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    for (let i = 0; i < N; i++) {
      s0 = signal[i] + alpha * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const real = s1 - s2 * cosW;
    const imag = s2 * sinW;
    const magnitude = Math.sqrt(real * real + imag * imag);

    return magnitude / N;
  };

  // Detect pulse frequency using Goertzel algorithm
  const detectPulseFrequency = (signal: number[]): { frequency: number; magnitude: number } => {
    if (signal.length < MIN_FRAMES) {
      return { frequency: 0, magnitude: 0 };
    }

    let maxMagnitude = 0;
    let maxFrequency = 0;

    // Check frequencies in valid heart rate range
    for (let freq = MIN_FREQUENCY; freq <= MAX_FREQUENCY; freq += 0.01) {
      const magnitude = goertzelMagnitude(signal, freq, FPS);
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        maxFrequency = freq;
      }
    }

    // Convert Hz to BPM
    const bpm = maxFrequency * 60;

    return {
      frequency: bpm,
      magnitude: maxMagnitude,
    };
  };

  // Add a frame to the rPPG buffer
  const addFrame = (imageData: Uint8ClampedArray, landmarks: any[]): void => {
    if (!isRecording) {
      setIsRecording(true);
    }

    const skinColor = extractSkinColor(imageData, landmarks);
    if (!skinColor) return;

    // Store RGB values
    rgbSignalRef.current.r.push(skinColor.r);
    rgbSignalRef.current.g.push(skinColor.g);
    rgbSignalRef.current.b.push(skinColor.b);
    timestampsRef.current.push(Date.now());

    // Keep window size bounded
    if (rgbSignalRef.current.r.length > WINDOW_SIZE) {
      rgbSignalRef.current.r.shift();
      rgbSignalRef.current.g.shift();
      rgbSignalRef.current.b.shift();
      timestampsRef.current.shift();
    }

    setFrameCount((prev) => prev + 1);
  };

  // Get current rPPG analysis result
  const getResult = (): rPPGResult | null => {
    const { r, g, b } = rgbSignalRef.current;

    if (r.length < MIN_FRAMES) {
      return {
        heartbeatDetected: false,
        pulseFrequency: 0,
        confidence: 0,
        isValid: false,
        signalStrength: 0,
        failureReason: `Need at least ${MIN_FRAMES} frames, have ${r.length}`,
      };
    }

    // Normalize signals
    const rNorm = normalize(r);
    const gNorm = normalize(g);
    const bNorm = normalize(b);

    // Combine channels (green is typically strongest for rPPG)
    // Use green + (green - red) for better isolation
    const combined = gNorm.map((g, i) => g + 0.5 * (g - rNorm[i]));

    // Detect pulse frequency
    const { frequency, magnitude } = detectPulseFrequency(combined);

    // Validate result
    const isValid = frequency >= 60 && frequency <= 120;
    const heartbeatDetected = isValid && magnitude > 0.1;

    // Confidence: based on signal magnitude and stability
    const confidence = Math.min(1, magnitude * 2);
    const signalStrength = magnitude;

    return {
      heartbeatDetected,
      pulseFrequency: Math.round(frequency),
      confidence,
      isValid,
      signalStrength,
      failureReason: !isValid ? `Pulse out of range: ${Math.round(frequency)} BPM` : undefined,
    };
  };

  const reset = (): void => {
    rgbSignalRef.current = { r: [], g: [], b: [] };
    timestampsRef.current = [];
    setFrameCount(0);
    setIsRecording(false);
  };

  return {
    ready,
    error,
    loading,
    addFrame,
    getResult,
    isRecording,
    frameCount,
    reset,
  };
}
