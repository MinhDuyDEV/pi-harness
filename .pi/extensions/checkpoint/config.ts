export interface CheckpointConfig {
  enabled: boolean;
  dir: string;
  maxPerSession: number;
  rebuildBudget: number;
  autoOnCompress: boolean;
  autoOnOverflow: boolean;
  maxFileSize: number;
}

export const DEFAULT_CHECKPOINT_CONFIG: CheckpointConfig = {
  enabled: true,
  dir: "checkpoints",
  maxPerSession: 20,
  rebuildBudget: 4000,
  autoOnCompress: true,
  autoOnOverflow: true,
  maxFileSize: 16384,
};
