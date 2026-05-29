/**
 * EnvelopeEditor — ADSR envelope configuration and visualisation helpers.
 *
 * Provides functions to compute envelope curves for preview rendering
 * and to convert between time-based and sample-based representations.
 */

import { ADSR } from './SoundEffect';

export interface EnvelopePoint {
  time: number;  // seconds
  value: number; // amplitude (0–1)
}

export class EnvelopeEditor {
  /**
   * Generate a list of envelope breakpoints for rendering the envelope shape.
   * Returns 4 points: start, attack peak, decay/sustain start, release end.
   */
  static getBreakpoints(envelope: ADSR, totalDuration: number): EnvelopePoint[] {
    const releaseStart = Math.max(envelope.attack + envelope.decay, totalDuration - envelope.release);
    return [
      { time: 0, value: 0 },
      { time: envelope.attack, value: 1 },
      { time: envelope.attack + envelope.decay, value: envelope.sustain },
      { time: releaseStart, value: envelope.sustain },
      { time: totalDuration, value: 0 },
    ];
  }

  /**
   * Evaluate the envelope at a given time (seconds).
   */
  static evaluate(envelope: ADSR, t: number, totalDuration: number): number {
    const { attack, decay, sustain, release } = envelope;
    const releaseStart = totalDuration - release;

    if (t <= 0) return 0;
    if (t < attack) return t / attack;
    if (t < attack + decay) return 1 - ((t - attack) / decay) * (1 - sustain);
    if (t < releaseStart) return sustain;
    if (t < totalDuration) return sustain * (1 - (t - releaseStart) / release);
    return 0;
  }

  /**
   * Generate an envelope curve as an array of values for display.
   */
  static generateCurve(
    envelope: ADSR,
    totalDuration: number,
    numPoints: number = 100,
  ): number[] {
    const curve: number[] = [];
    for (let i = 0; i < numPoints; i++) {
      const t = (i / (numPoints - 1)) * totalDuration;
      curve.push(EnvelopeEditor.evaluate(envelope, t, totalDuration));
    }
    return curve;
  }

  /**
   * Clamp envelope values to valid ranges.
   */
  static clamp(envelope: ADSR): ADSR {
    return {
      attack: Math.max(0.001, Math.min(2, envelope.attack)),
      decay: Math.max(0.001, Math.min(2, envelope.decay)),
      sustain: Math.max(0, Math.min(1, envelope.sustain)),
      release: Math.max(0.001, Math.min(5, envelope.release)),
    };
  }

  /**
   * Compute total duration that this envelope fills.
   */
  static computeDuration(envelope: ADSR, baseDuration: number): number {
    return Math.max(baseDuration, envelope.attack + envelope.decay + envelope.release);
  }
}
