/**
 * SoundEffect — data model for a chiptune-style sound effect.
 *
 * Defines waveform type, frequency parameters, ADSR envelope, and duration.
 * Can be serialized to JSON for export.
 */

export type WaveformType = 'square' | 'triangle' | 'sawtooth' | 'noise';

export interface ADSR {
  attack: number;   // seconds (0–2)
  decay: number;    // seconds (0–2)
  sustain: number;  // level (0–1)
  release: number;  // seconds (0–5)
}

export interface SoundEffectParams {
  waveform: WaveformType;
  /** Base frequency in Hz */
  frequency: number;
  /** Optional frequency sweep end (for effects like lasers) */
  frequencyEnd?: number;
  /** Duration in seconds */
  duration: number;
  /** Volume (0–1) */
  volume: number;
  /** ADSR envelope */
  envelope: ADSR;
  /** Optional duty cycle for square wave (0–1, default 0.5) */
  dutyCycle?: number;
}

export interface SoundEffectData {
  id: string;
  name: string;
  params: SoundEffectParams;
}

export class SoundEffect {
  readonly id: string;
  name: string;
  params: SoundEffectParams;

  constructor(id: string, name: string, params: Partial<SoundEffectParams> = {}) {
    this.id = id;
    this.name = name;
    this.params = {
      waveform: params.waveform ?? 'square',
      frequency: params.frequency ?? 440,
      frequencyEnd: params.frequencyEnd,
      duration: params.duration ?? 0.5,
      volume: params.volume ?? 0.3,
      envelope: {
        attack: params.envelope?.attack ?? 0.01,
        decay: params.envelope?.decay ?? 0.1,
        sustain: params.envelope?.sustain ?? 0.5,
        release: params.envelope?.release ?? 0.2,
      },
      dutyCycle: params.dutyCycle ?? 0.5,
    };
  }

  /** Create a deep clone. */
  clone(): SoundEffect {
    return new SoundEffect(this.id, this.name, JSON.parse(JSON.stringify(this.params)));
  }

  /** Serialize to plain object for storage/export. */
  toJSON(): SoundEffectData {
    return {
      id: this.id,
      name: this.name,
      params: { ...this.params, envelope: { ...this.params.envelope } },
    };
  }

  /** Deserialize from plain object. */
  static fromJSON(data: SoundEffectData): SoundEffect {
    return new SoundEffect(data.id, data.name, data.params);
  }
}

/** Default sound effects for common game events. */
export const DEFAULT_SOUND_EFFECTS: SoundEffect[] = [
  new SoundEffect('collect', 'Collect Coin', {
    waveform: 'square', frequency: 880, frequencyEnd: 1320, duration: 0.15, volume: 0.25,
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.3, release: 0.1 },
  }),
  new SoundEffect('jump', 'Jump', {
    waveform: 'square', frequency: 330, frequencyEnd: 660, duration: 0.2, volume: 0.2,
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.4, release: 0.15 },
  }),
  new SoundEffect('hit', 'Hit', {
    waveform: 'noise', frequency: 200, duration: 0.3, volume: 0.3,
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.2, release: 0.2 },
  }),
  new SoundEffect('death', 'Death', {
    waveform: 'sawtooth', frequency: 440, frequencyEnd: 110, duration: 0.6, volume: 0.3,
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.4 },
  }),
  new SoundEffect('powerup', 'Power Up', {
    waveform: 'triangle', frequency: 440, frequencyEnd: 880, duration: 0.5, volume: 0.25,
    envelope: { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.3 },
  }),
  new SoundEffect('trigger', 'Trigger', {
    waveform: 'square', frequency: 660, frequencyEnd: 990, duration: 0.2, volume: 0.2,
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.3, release: 0.1 },
    dutyCycle: 0.25,
  }),
];
