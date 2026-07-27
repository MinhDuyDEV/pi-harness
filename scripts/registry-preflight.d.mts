export interface RegistryPin {
  source: string;
  spec: string;
  version: string;
}

export interface RegistryResult {
  name: string;
  version: string;
  spec: string;
  available: boolean;
  status: "available" | "missing" | "mismatch" | "error";
  detail: string;
}

export function checkRegistryPins(
  pins: Record<string, RegistryPin>,
  run?: (...args: any[]) => {
    status: number | null;
    stdout?: string;
    stderr?: string;
    error?: { message?: string };
  },
): RegistryResult[];
export function renderRegistryReport(results: RegistryResult[]): string;
