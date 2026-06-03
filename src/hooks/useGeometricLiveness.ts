// useGeometricLiveness.ts — Eye blink + head pose liveness detection
// Detects: eye aspect ratio (EAR), blink count, head pose (pitch/yaw/roll)

import { useEffect, useState, useRef } from 'react';
import * as FileSystem from 'expo-file-system';

export interface HeadPose {
  pitch: number;  // Up/down (-90 to +90 degrees)
  yaw: number;    // Left/right (-90 to +90 degrees)
  roll: number;   // Tilt (-45 to +45 degrees)
}

export interface EyeMetrics {
  leftEAR: number;      // 0-1 (>0.2 = open)
  rightEAR: number;
  averageEAR: number;
  blinkCount: number;   // Total blinks detected
  isBlinking: boolean;  // Currently blinking
}

export interface GeometricLivenessResult {
  isAlive: boolean;       // Overall liveness decision
  eyeMetrics: EyeMetrics;
  headPose: HeadPose;
  score: number;          // 0-1 confidence
  failureReason?: string; // Why check failed (if applicable)
}

export interface UseGeometricLivenessState {
  ready: boolean;
  error: string | null;
  loading: boolean;
  analyzeFrame: (landmarks: any[]) => GeometricLivenessResult | null;
  reset: () => void;
}

const EAR_THRESHOLD = 0.2;              // EAR < 0.2 = eyes closed
const BLINK_THRESHOLD = 0.15;            // Lower = closed
const MIN_BLINKS = 2;                   // Must have 2+ blinks in duration
const YAW_THRESHOLD = 30;               // Max head rotation left/right (degrees)
const PITCH_THRESHOLD = 20;             // Max head tilt up/down (degrees)

// MediaPipe eye landmark indices
const LEFT_EYE = {
  p1: 33,  p2: 160, p3: 158, p4: 133, p5: 153, p6: 144,
};
const RIGHT_EYE = {
  p1: 362, p2: 385, p3: 387, p4: 263, p5: 373, p6: 380,
};

// Face geometry for head pose estimation
const FACE_LANDMARKS_HEAD_POSE = {
  noseTip: 1,        // Tip of nose
  leftCheek: 50,     // Left side
  rightCheek: 280,   // Right side
  topForehead: 10,   // Top center
};

export function useGeometricLiveness(): UseGeometricLivenessState {
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const blinkHistoryRef = useRef<number[]>([]);
  const previousEARRef = useRef<number>(0.3);

  // Detect blink: EAR dips below threshold then rises above
  const detectBlink = (currentEAR: number): boolean => {
    const wasOpen = previousEARRef.current > EAR_THRESHOLD;
    const isClosed = currentEAR < BLINK_THRESHOLD;
    const isBlink = wasOpen && isClosed;

    previousEARRef.current = currentEAR;
    return isBlink;
  };

  // Compute Eye Aspect Ratio (EAR)
  // EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
  const computeEAR = (
    landmarks: any[],
    eyeIndices: typeof LEFT_EYE
  ): number => {
    const p1 = landmarks[eyeIndices.p1];
    const p2 = landmarks[eyeIndices.p2];
    const p3 = landmarks[eyeIndices.p3];
    const p4 = landmarks[eyeIndices.p4];
    const p5 = landmarks[eyeIndices.p5];
    const p6 = landmarks[eyeIndices.p6];

    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) {
      return 0;
    }

    const distance = (a: any, b: any) =>
      Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

    const num = distance(p2, p6) + distance(p3, p5);
    const den = 2 * distance(p1, p4);

    return den === 0 ? 0 : num / den;
  };

  // Estimate head pose using facial landmarks
  // Uses nose tip, cheeks, and forehead to determine rotation
  const estimateHeadPose = (landmarks: any[]): HeadPose => {
    const nose = landmarks[FACE_LANDMARKS_HEAD_POSE.noseTip];
    const leftCheek = landmarks[FACE_LANDMARKS_HEAD_POSE.leftCheek];
    const rightCheek = landmarks[FACE_LANDMARKS_HEAD_POSE.rightCheek];
    const forehead = landmarks[FACE_LANDMARKS_HEAD_POSE.topForehead];

    if (!nose || !leftCheek || !rightCheek || !forehead) {
      return { pitch: 0, yaw: 0, roll: 0 };
    }

    // YAW: Left/right rotation based on nose-to-cheek distance
    const noseX = nose.x;
    const leftDist = Math.abs(noseX - leftCheek.x);
    const rightDist = Math.abs(noseX - rightCheek.x);
    const yaw = (rightDist - leftDist) * 90; // Normalized to [-90, 90]

    // PITCH: Up/down tilt based on nose-to-forehead distance
    const noseY = nose.y;
    const foreheadY = forehead.y;
    const pitchDistance = noseY - foreheadY;
    const pitch = Math.max(-20, Math.min(20, pitchDistance * 100)); // Clamp to [-20, 20]

    // ROLL: Head tilt left/right (simplified using eye angle)
    const leftEye = landmarks[LEFT_EYE.p1];
    const rightEye = landmarks[RIGHT_EYE.p1];
    const eyeAngle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    const roll = (eyeAngle * 180) / Math.PI;

    return {
      pitch: Math.max(-90, Math.min(90, pitch)),
      yaw: Math.max(-90, Math.min(90, yaw)),
      roll: Math.max(-45, Math.min(45, roll)),
    };
  };

  // Main analysis function
  const analyzeFrame = (landmarks: any[]): GeometricLivenessResult | null => {
    try {
      if (!landmarks || landmarks.length === 0) {
        return {
          isAlive: false,
          eyeMetrics: {
            leftEAR: 0,
            rightEAR: 0,
            averageEAR: 0,
            blinkCount: 0,
            isBlinking: false,
          },
          headPose: { pitch: 0, yaw: 0, roll: 0 },
          score: 0,
          failureReason: 'No landmarks detected',
        };
      }

      // Compute EAR for both eyes
      const leftEAR = computeEAR(landmarks, LEFT_EYE);
      const rightEAR = computeEAR(landmarks, RIGHT_EYE);
      const averageEAR = (leftEAR + rightEAR) / 2;

      // Detect blink
      const isBlink = detectBlink(averageEAR);
      if (isBlink) {
        blinkHistoryRef.current.push(Date.now());
      }

      // Keep only recent blinks (last 5 seconds)
      const now = Date.now();
      blinkHistoryRef.current = blinkHistoryRef.current.filter(
        (t) => now - t < 5000
      );

      const blinkCount = blinkHistoryRef.current.length;

      // Estimate head pose
      const headPose = estimateHeadPose(landmarks);

      // Evaluate liveness
      const eyesOpen = averageEAR > EAR_THRESHOLD;
      const headInFrame =
        Math.abs(headPose.yaw) < YAW_THRESHOLD &&
        Math.abs(headPose.pitch) < PITCH_THRESHOLD;

      const hasBlinks = blinkCount >= MIN_BLINKS;

      // Score: higher = more alive
      let score = 0;
      if (eyesOpen) score += 0.3;
      if (headInFrame) score += 0.4;
      if (hasBlinks) score += 0.3;

      const isAlive = score >= 0.7; // Must pass all checks

      return {
        isAlive,
        eyeMetrics: {
          leftEAR,
          rightEAR,
          averageEAR,
          blinkCount,
          isBlinking: averageEAR < BLINK_THRESHOLD,
        },
        headPose,
        score,
        failureReason: !eyesOpen
          ? 'Eyes closed'
          : !headInFrame
            ? 'Head not in frame'
            : !hasBlinks
              ? 'Not enough blinks detected'
              : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      console.error('useGeometricLiveness.analyzeFrame:', msg);
      return null;
    }
  };

  const reset = () => {
    blinkHistoryRef.current = [];
    previousEARRef.current = 0.3;
  };

  return {
    ready,
    error,
    loading,
    analyzeFrame,
    reset,
  };
}
