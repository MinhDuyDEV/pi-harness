import { runCli } from "./subprocess.js";

export type ChangedSinceSelection =
  | { ok: true; ref: string; source: "explicit" | "auto" }
  | { ok: false; requested: string; reason: string };

type RefVerifier = (ref: string) => Promise<boolean>;

const AUTO_BASELINES = ["@{upstream}", "origin/HEAD", "main", "master", "HEAD~1"] as const;

function isSafeRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    ref.length <= 200 &&
    !ref.startsWith("-") &&
    !/[\u0000-\u001F\u007F\s]/u.test(ref)
  );
}

export async function selectChangedSince(
  requested: string,
  verify: RefVerifier,
): Promise<ChangedSinceSelection> {
  if (requested !== "auto") {
    if (!isSafeRef(requested)) {
      return { ok: false, requested, reason: "Git baseline is unsafe or exceeds 200 characters" };
    }
    return await verify(requested)
      ? { ok: true, ref: requested, source: "explicit" }
      : { ok: false, requested, reason: "Git baseline does not resolve to a commit" };
  }

  for (const ref of AUTO_BASELINES) {
    if (await verify(ref)) return { ok: true, ref, source: "auto" };
  }
  return {
    ok: false,
    requested,
    reason: "No automatic Git baseline resolves to a commit",
  };
}

export async function resolveChangedSince(
  root: string,
  requested: string,
  signal?: AbortSignal,
): Promise<ChangedSinceSelection> {
  return selectChangedSince(requested, async (ref) => {
    const result = await runCli({
      bin: "git",
      args: ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
      cwd: root,
      signal,
      timeoutMs: 5_000,
      maxBuffer: 64 * 1024,
    });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  });
}
