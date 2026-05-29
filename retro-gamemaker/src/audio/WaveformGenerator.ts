/**
 * WaveformGenerator — generates raw PCM audio data (Float32Array) from
 * SoundEffect parameters using Web Audio API.
 *
 * Each waveform type produces a different 8-bit-style chiptune sound.
 */

import { WaveformType, ADSR } from './SoundEffect';

export interface GeneratedBuffer {
  /** Raw PCM samples (mono, -1 to 1) */
  samples: Float32Array;
  /** Sample rate used */
  sampleRate: number;
}

export class WaveformGenerator {
  static readonly DEFAULT_SAMPLE_RATE = 44100;

  /**
   * Generate audio samples for a given waveform.
   */
  static generate(
    waveform: WaveformType,
    frequency: number,
    frequencyEnd: number | undefined,
    duration: number,
    volume: number,
    envelope: ADSR,
    sampleRate: number = WaveformGenerator.DEFAULT_SAMPLE_RATE,
    dutyCycle: number = 0.5,
  ): GeneratedBuffer {
    const numSamples = Math.ceil(sampleRate * duration);
    const samples = new Float32Array(numSamples);
    const freqEnd = frequencyEnd ?? frequency;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const progress = i / numSamples;

      // Frequency sweep
      const freq = frequency + (freqEnd - frequency) * progress;
      const phase = 2 * Math.PI * freq * t;

      // Generate waveform
      let value: number;
      switch (waveform) {
        case 'square':
          value = (t * freq) % 1 < dutyCycle ? 1 : -1;
          break;
        case 'triangle':
          value = 2 * Math.abs(2 * ((t * freq) % 1) - 1) - 1;
          break;
        case 'sawtooth':
          value = 2 * ((t * freq) % 1) - 1;
          break;
        case 'noise':
          value = Math.random() * 2 - 1;
          break;
        default:
          value = Math.sin(phase);
      }

      // Apply envelope
      const env = WaveformGenerator._applyEnvelope(i, numSamples, envelope, sampleRate);
      samples[i] = value * volume * env;
    }

    return { samples, sampleRate };
  }

  /**
   * Convert generated samples to a Web Audio AudioBuffer for playback.
   */
  static toAudioBuffer(
    audioCtx: AudioContext,
    buffer: GeneratedBuffer,
  ): AudioBuffer {
    const audioBuffer = audioCtx.createBuffer(1, buffer.samples.length, buffer.sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    channelData.set(buffer.samples);
    return audioBuffer;
  }

  /**
   * Compute the ADSR envelope value at a given sample index.
   */
  private static _applyEnvelope(
    sampleIndex: number,
    totalSamples: number,
    envelope: ADSR,
    sampleRate: number,
  ): number {
    const t = sampleIndex / sampleRate;
    const { attack, decay, sustain, release } = envelope;
    const totalDuration = totalSamples / sampleRate;
    const releaseStart = totalDuration - release;

    if (t < attack) {
      // Attack phase: linear ramp 0→1
      return t / attack;
    } else if (t < attack + decay) {
      // Decay phase: ramp 1→sustain
      const dt = (t - attack) / decay;
      return 1 - dt * (1 - sustain);
    } else if (t < releaseStart) {
      // Sustain phase
      return sustain;
    } else {
      // Release phase: ramp sustain→0
      const rt = (t - releaseStart) / release;
      return sustain * (1 - rt);
    }
  }
}
