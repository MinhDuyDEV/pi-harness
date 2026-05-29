/**
 * AudioManager — manages sound effect playback and storage.
 *
 * Maintains a map of sound effects keyed by ID.
 * Uses Web Audio API for playback with pre-buffering.
 */

import { SoundEffect, SoundEffectData, DEFAULT_SOUND_EFFECTS } from './SoundEffect';
import { WaveformGenerator } from './WaveformGenerator';

export type BehaviorSoundMapping = 'collect' | 'jump' | 'hit' | 'death' | 'powerup' | 'trigger';

export class AudioManager {
  private audioCtx: AudioContext | null = null;
  private sounds: Map<string, SoundEffect> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  private behaviorMapping: Map<BehaviorSoundMapping, string> = new Map();

  constructor() {
    for (const sfx of DEFAULT_SOUND_EFFECTS) {
      this.sounds.set(sfx.id, sfx);
    }
  }

  private ensureContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  setSound(sfx: SoundEffect): void {
    this.sounds.set(sfx.id, sfx);
    this.buffers.delete(sfx.id);
  }

  getSound(id: string): SoundEffect | undefined {
    return this.sounds.get(id);
  }

  getAllSounds(): SoundEffect[] {
    return Array.from(this.sounds.values());
  }

  removeSound(id: string): void {
    this.sounds.delete(id);
    this.buffers.delete(id);
  }

  private render(sfx: SoundEffect): AudioBuffer {
    const ctx = this.ensureContext();
    const generated = WaveformGenerator.generate(
      sfx.params.waveform,
      sfx.params.frequency,
      sfx.params.frequencyEnd,
      sfx.params.duration,
      sfx.params.volume,
      sfx.params.envelope,
      ctx.sampleRate,
      sfx.params.dutyCycle,
    );
    const buffer = WaveformGenerator.toAudioBuffer(ctx, generated);
    this.buffers.set(sfx.id, buffer);
    return buffer;
  }

  play(id: string): boolean {
    const sfx = this.sounds.get(id);
    if (!sfx) return false;

    try {
      const ctx = this.ensureContext();
      let buffer = this.buffers.get(id);
      if (!buffer) {
        buffer = this.render(sfx);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  playBehavior(event: BehaviorSoundMapping): boolean {
    const soundId = this.behaviorMapping.get(event);
    if (!soundId) return false;
    return this.play(soundId);
  }

  assignBehavior(event: BehaviorSoundMapping, soundId: string): void {
    this.behaviorMapping.set(event, soundId);
  }

  getBehaviorSound(event: BehaviorSoundMapping): string | undefined {
    return this.behaviorMapping.get(event);
  }

  getBehaviorMapping(): Map<BehaviorSoundMapping, string> {
    return new Map(this.behaviorMapping);
  }

  toJSON(): SoundEffectData[] {
    return this.getAllSounds().map((s) => s.toJSON());
  }

  fromJSON(data: SoundEffectData[]): void {
    for (const d of data) {
      this.sounds.set(d.id, SoundEffect.fromJSON(d));
    }
  }
}
