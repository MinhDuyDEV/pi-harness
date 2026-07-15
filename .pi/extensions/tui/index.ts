
import {
  copyToClipboard,
  isBashToolResult,
  isEditToolResult,
  isWriteToolResult,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { basename as pathBasename, dirname as pathDirname } from "node:path";
import { createQueueTracker, createDefaultSidebarState, renderSidebar, sidebarTotalWidth } from "./sidebar.js";
import {
  hasOpenTodos,
  findCanonicalTodo,
  scanTodos,
  renderTodosWidget,
  type TodosState,
} from "./todos-panel.js";
import { createDefaultFooterState } from "./footer.js";
import { streamingPromptFramesForThinkingLevel } from "./editor-prompt.js";
import {
  refreshGitInfo,
  invalidateGitStatus,
  getCachedGitInfo,
  type GitInfo,
} from "./git-status.js";
import { AmpBoxEditor } from "./editor.js";
import { FixedEditorCompositor, emergencyTerminalModeReset } from "./fixed-editor/compositor.js";
import { readPiTuiSettings, type PiTuiSettings } from "./settings.js";
import {
  findRenderableContainerWithChild,
  isRenderable,
} from "./render-tree.js";
import {
  pickRandomWorkingQuote,
  workingStatusSpacerLines,
} from "./working-indicator.js";
import {
  addUsageTokenMetrics,
  displayedTurnUsage,
  emptyUsageTokenMetrics,
  hasUsageTokenMetrics,
  restoreUsageSnapshotFromBranch,
  usageCostUsd,
  usageTokenMetrics,
  type UsageTokenMetrics,
} from "./usage.js";

/** Lightweight wave animation for the editor streaming prompt. ~200ms for smooth feel. */
const DEFAULT_STREAMING_PROMPT_FRAMES = ["≈", "≋", "⋍", "≋"];
const STREAMING_PROMPT_INTERVAL_MS = 200;

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic",
  "amazon-bedrock": "Amazon Bedrock",
  "azure-openai-responses": "Azure OpenAI",
  cerebras: "Cerebras",
  "cloudflare-ai-gateway": "Cloudflare AI",
  "cloudflare-workers-ai": "Cloudflare Workers",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  google: "Google Gemini",
  "google-vertex": "Google Vertex",
  groq: "Groq",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi",
  mistral: "Mistral",
  minimax: "MiniMax",
  moonshotai: "Moonshot AI",
  "opencode-go": "OpenCode Go",
  opencode: "OpenCode Zen",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter",
  together: "Together AI",
  "vercel-ai-gateway": "Vercel AI",
  xai: "xAI",
  "xai-auth": "xAI Grok",
  zai: "zAI",
  xiaomi: "Xiaomi MiMo",
};

function providerDisplay(id: string): string {
  return PROVIDER_DISPLAY[id] || id;
}

function modelLabel(model: {
  name?: string;
  id: string;
  provider?: string;
}): string {
  const name = model.name || model.id;
  if (model.provider) {
    return providerDisplay(model.provider) + " / " + name;
  }
  return name;
}


export default function piTuiExtension(pi: ExtensionAPI) {
  // ── State ────────────────────────────────────────────────────────────────
  const queue = createQueueTracker();
      let todosState: TodosState = { items: [], sourceFile: null, sourceCount: 0 };
  const footer = createDefaultFooterState();
  const sidebar = createDefaultSidebarState();
  let footerInstalled = false;
  let piTuiSettings: PiTuiSettings = {};

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let clipboardStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let progressKeepalive: ReturnType<typeof setInterval> | null = null;
  let turnStartTime = 0;
  let todosWatcher: FSWatcher | null = null;
  let todosWatchDebounce: ReturnType<typeof setTimeout> | null = null;
  let lastNotifiedOpenCount = -1;

  // ── Todo file watcher ────────────────────────────────────────────
  // Watches the canonical TODO.md so any change (editor, bash, other
  // extensions, external) triggers an immediate widget refresh. The
  // tool_result handler only catches Edit/Write/Bash results, so this
  // is the safety net for vim, sed, and any out-of-band edit.
  const TODO_WATCH_DEBOUNCE_MS = 100;

  function teardownTodosWatcher(): void {
    if (todosWatcher) {
      todosWatcher.close();
      todosWatcher = null;
    }
    if (todosWatchDebounce) {
      clearTimeout(todosWatchDebounce);
      todosWatchDebounce = null;
    }
  }

  function refreshTodosWithNotify(cwd: string, source: string, piCtx: ExtensionContext): void {
    refreshTodos(cwd);
    const openCount = todosState.items.filter((it) => !it.done).length;
    // Only notify when the open count actually changes — avoids
    // notification spam while still surfacing meaningful updates.
    if (openCount !== lastNotifiedOpenCount) {
      lastNotifiedOpenCount = openCount;
      try {
        piCtx.ui.notify(`Todo list refreshed (${openCount} open, via ${source})`, "info");
      } catch {
        // best-effort; some UIs may not implement notify
      }
    }
  }

  function watchTodosFile(cwd: string, piCtx: ExtensionContext): void {
    teardownTodosWatcher();
    const todoPath = findCanonicalTodo(cwd);
    if (!todoPath) return;
    const dir = pathDirname(todoPath);
    const target = pathBasename(todoPath);
    try {
      todosWatcher = fsWatch(dir, (eventType, changedFilename) => {
        if (!changedFilename || changedFilename !== target) return;
        if (todosWatchDebounce) clearTimeout(todosWatchDebounce);
        todosWatchDebounce = setTimeout(() => {
          todosWatchDebounce = null;
          refreshTodosWithNotify(cwd, "file-watch", piCtx);
          scheduleRefresh(piCtx);
        }, TODO_WATCH_DEBOUNCE_MS);
      });
    } catch {
      // fs.watch can throw on missing dirs / permission errors; skip silently
      todosWatcher = null;
    }
  }

  // ── Streaming prompt state ─────────────────────────────────────────────
  let editorStreamingPrompt: string | null = null;
  let streamPromptAnimTimer: ReturnType<typeof setInterval> | null = null;
  let streamPromptAnimFrame = 0;
  let lastCompletedTurnUsage: UsageTokenMetrics = emptyUsageTokenMetrics();
  let currentCompletedTurnUsage: UsageTokenMetrics = emptyUsageTokenMetrics();
  let streamingTurnUsage: UsageTokenMetrics = emptyUsageTokenMetrics();

  function setEditorStreamingPrompt(prompt: string | null) {
    editorStreamingPrompt = prompt;
    currentEditor?.setStreamingPrompt(prompt);
  }

  function publishTurnUsage() {
    const metrics = displayedTurnUsage(lastCompletedTurnUsage, currentCompletedTurnUsage, streamingTurnUsage);
    footer.turnTokens = metrics.total;
    footer.turnInputTokens = metrics.input;
    footer.turnOutputTokens = metrics.output;
    footer.turnCacheReadTokens = metrics.cacheRead;
    footer.turnCacheWriteTokens = metrics.cacheWrite;
  }

  function applyWorkingRowPadding(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    // Native Pi working rows render spinner + message inline. Prefixing the
    // message with newlines splits them into separate rows (`⠧` then
    // `Connecting neurons...`). Keep the native loader single-line.
    // Fixed-editor spacing is handled separately via workingStatusSpacerLines().
    ctx.ui.setWorkingMessage(pickRandomWorkingQuote());
  }

  function startFooterAnim(ctx: ExtensionContext) {
    const frames = streamingPromptFramesForThinkingLevel(footer.thinkingLevel);
    if (editorStreamingPrompt === frames[0]) return;

    // Restore Pi's native animated working indicator (spinner).
    if (ctx.hasUI) {
      applyWorkingRowPadding(ctx);
      ctx.ui.setWorkingIndicator();
    }

    // Editor wave animation is TUI-only — no editor in RPC/JSON/print modes.
    if (ctx.mode !== "tui") return;

    // Start lightweight wave animation for editor prompt character.
    streamPromptAnimFrame = 0;
    setEditorStreamingPrompt(frames[0]);
    currentEditor?.setThinkingLevel(footer.thinkingLevel);

    if (!streamPromptAnimTimer) {
      streamPromptAnimTimer = setInterval(() => {
        if (!footer.isStreaming) return;
        const nextFrames = streamingPromptFramesForThinkingLevel(footer.thinkingLevel)
          ?? DEFAULT_STREAMING_PROMPT_FRAMES;
        streamPromptAnimFrame = (streamPromptAnimFrame + 1) % nextFrames.length;
        setEditorStreamingPrompt(nextFrames[streamPromptAnimFrame]);
      }, STREAMING_PROMPT_INTERVAL_MS);
      streamPromptAnimTimer.unref?.();
    }
  }

  function stopFooterAnim(ctx: ExtensionContext) {
    setEditorStreamingPrompt(null);
    if (streamPromptAnimTimer) {
      clearInterval(streamPromptAnimTimer);
      streamPromptAnimTimer = null;
    }
  }

  // ── Refresh git info (fire-and-forget) ───────────────────────────────────
  function updateGit(ctx: ExtensionContext) {
    refreshGitInfo(ctx.cwd).then((git) => {
      footer.git = git;
      if (footer.tui) footer.tui.requestRender();
    });
  }

  // ── Refresh UI ───────────────────────────────────────────────────────────
  function refreshUI(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;

    if (ctx.model) {
      footer.modelLabel = modelLabel(ctx.model);
      footer.contextWindow = ctx.model.contextWindow ?? 0;
    }
    const usage = ctx.getContextUsage();
        if (usage) {
          footer.tokenCount = usage.tokens ?? 0;
        }
        footer.cwd = ctx.cwd;
        // Keep last known git info as sidebar fallback during async refresh gaps.
        const freshGit = getCachedGitInfo();
        if (freshGit) lastKnownGit = freshGit;
        footer.git = freshGit ?? lastKnownGit;

        sidebar.todos = todosState;
        sidebar.queue = queue.state();
        sidebar.git = footer.git;
        sidebar.modelLabel = footer.modelLabel;
        sidebar.tokenCount = footer.tokenCount;
        sidebar.contextWindow = footer.contextWindow;
        sidebar.totalCostUsd = footer.totalCostUsd;
        sidebar.thinkingLevel = footer.thinkingLevel;
        sidebar.cwd = ctx.cwd;
        sidebar.piVersion = VERSION;
        const terminalWidth = typeof tuiRef?.terminal?.columns === "number" ? tuiRef.terminal.columns : 0;
        const sidebarVisible = sidebarTotalWidth(sidebar, terminalWidth) > 0;

        // Widgets — hide when empty. The sidebar owns queue/TODOs when visible.
        if (hasOpenTodos(todosState) && !sidebarVisible) {
          ctx.ui.setWidget(
            "amp-todos",
            (_tui: TUI, theme: Theme) =>
              renderTodosWidget(todosState, _tui, theme),
            { placement: "belowEditor" },
          );
        } else {
          ctx.ui.setWidget("amp-todos", undefined, {
            placement: "belowEditor",
          });
        }


    compositor?.invalidateCluster();
    syncFixedRenderables();
    footer.tui?.requestRender();
  }

  function scheduleRefresh(ctx: ExtensionContext, delayMs = 50) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshUI(ctx);
      refreshTimer = null;
    }, delayMs);
  }

  function refreshTodos(cwd: string) {
    todosState = scanTodos(cwd);
  }

  function restoreUsageFromBranch(ctx: ExtensionContext) {
    const snapshot = restoreUsageSnapshotFromBranch(ctx.sessionManager.getBranch());
    footer.turnElapsed = snapshot.elapsedMs;
    lastCompletedTurnUsage = snapshot.lastTurn;
    currentCompletedTurnUsage = emptyUsageTokenMetrics();
    streamingTurnUsage = emptyUsageTokenMetrics();
    publishTurnUsage();
    footer.totalCostUsd = snapshot.totalCostUsd;
  }

  // ── Editor reference (for cursor blink cleanup) ──────────────────────────
  // Stable git info fallback — survives async refresh gaps after invalidation.
  let lastKnownGit: GitInfo | null = null;

  let currentEditor: AmpBoxEditor | null = null;
  let compositor: FixedEditorCompositor | null = null;
  let tuiRef: any = null;
  let fixedEditorContainer: any = null;
  let fixedStatusContainer: any = null;
  let fixedWidgetContainerAbove: any = null;
  let fixedQueueContainer: any = null;
  let fixedWidgetContainerBelow: any = null;
  let fixedFooterContainer: any = null;
  // Default OFF; session_start applies project settings.
  let fixedEditorEnabled = false;

  // ── Session lifecycle ────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    // Do NOT call setWorkingVisible(false) here. The SDK auto-creates the
    // working loader (spinner + working message) inside the status
    // container in its message_start path, but only when `workingVisible`
    // is still true. Flipping it to false here would prevent the spinner
    // from ever being created, leaving the status row of the fixed
    // cluster empty even while the agent is streaming.
    if (ctx.hasUI) {
      ctx.ui.setWorkingMessage(pickRandomWorkingQuote());
    }
    footer.isStreaming = false;
    footer.tokenCount = 0;
    footer.contextWindow = 0;
    setEditorStreamingPrompt(null);
    footer.cwd = ctx.cwd;
    footer.git = null;
    footer.thinkingLevel = "";
    footer.turnElapsed = 0;
    footer.turnTokens = 0;
    footer.turnInputTokens = 0;
    footer.turnOutputTokens = 0;
    footer.turnCacheReadTokens = 0;
    footer.turnCacheWriteTokens = 0;
    footer.totalCostUsd = 0;
    turnStartTime = 0;

    try {
      footer.thinkingLevel = pi.getThinkingLevel();
    } catch {
      /* ignore */
    }

    if (ctx.model) {
      footer.modelLabel = modelLabel(ctx.model);
      footer.contextWindow = ctx.model.contextWindow ?? 0;
    }

    restoreUsageFromBranch(ctx);

    refreshTodos(ctx.cwd);
    // Set up the file watcher so out-of-band edits (vim, sed, any tool
    // that doesn't match the path check below) still refresh the panel.
    watchTodosFile(ctx.cwd, ctx);
    piTuiSettings = readPiTuiSettings(ctx.cwd);
    fixedEditorEnabled = piTuiSettings.fixedEditorEnabled === true;
    applyWorkingRowPadding(ctx);
    updateGit(ctx);

    // Set boxed editor with $ / $$ prompt
    if (ctx.mode === "tui") {
      ctx.ui.setEditorComponent((tui, theme, kb) => {
        tuiRef = tui;
        currentEditor = new AmpBoxEditor(
          tui,
          theme,
          kb,
          ctx.ui.theme,
          piTuiSettings.editorPaddingX,
          footer.thinkingLevel,
        );

        currentEditor.setStreamingPrompt(editorStreamingPrompt);


        // After editor is created, initialize the compositor if fixed-editor is enabled
        tryInitCompositor(tui, ctx);

        return currentEditor;
      });
    }

    refreshUI(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    teardownTodosWatcher();
    if (compositor) {
      compositor.dispose();
      compositor = null;
    }
    if (currentEditor) {
      currentEditor.dispose();
      currentEditor = null;
    }
    tuiRef = null;
    fixedEditorContainer = null;
    fixedStatusContainer = null;
    fixedWidgetContainerAbove = null;
    fixedQueueContainer = null;
    fixedWidgetContainerBelow = null;
    fixedFooterContainer = null;
    fixedEditorEnabled = false;
    footerInstalled = false;
    footer.tui = null;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (clipboardStatusTimer) {
      clearTimeout(clipboardStatusTimer);
      clipboardStatusTimer = null;
    }
    if (streamPromptAnimTimer) {
      clearInterval(streamPromptAnimTimer);
      streamPromptAnimTimer = null;
    }
    if (progressKeepalive) {
      clearInterval(progressKeepalive);
      progressKeepalive = null;
    }
    try {
      ctx.ui.setEditorComponent(undefined);
    } catch {
      /* best effort */
    }
  });

  // ── Queue & agent events ─────────────────────────────────────────────────
  pi.on("input", async (event, ctx) => {
    const streamingBehavior = (event as { streamingBehavior?: string }).streamingBehavior;
    queue.onInput(streamingBehavior);
    scheduleRefresh(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Track loaded context files and skills for sidebar display.
    const opts = event.systemPromptOptions;
    if (opts) {
      sidebar.contextFilesCount = opts.contextFiles?.length ?? 0;
      sidebar.activeSkillsCount = opts.skills?.length ?? 0;
      scheduleRefresh(ctx);
    }

    const openItems = todosState.items.filter((item) => !item.done);
    if (openItems.length === 0) return;
    const lines = openItems.map((item) => `- [ ] ${item.text}`);
    const source = openItems[0].sourceFile.replace(ctx.cwd + "/", "");
    const content = `Active TODOs (${openItems.length} open, source: ${source}):\n${lines.join("\n")}\n\nComplete these and mark them [x] in the source file.`;
    return {
      message: {
        customType: "active-todos",
        content,
        display: true,
      },
    };
  });



  const inTmux = !!process.env.TMUX;

  /** Emit OSC 9;4 — if inside tmux, use passthrough DCS to bypass tmux processing. */
  function emitOscProgress(sequence: string) {
    if (inTmux) {
      // Tmux passthrough: DCS tmux; <escaped-data> ST
      // Each 0x1b in data is doubled to escape it.
      const escaped = sequence.replace(/\x1b/g, "\x1b\x1b");
      process.stdout.write(`\x1bPtmux;${escaped}\x1b\\`);
    } else {
      process.stdout.write(sequence);
    }
  }

  pi.on("agent_start", async (_event, ctx) => {
    footer.isStreaming = true;
    // Honor the user's `terminal.showTerminalProgress` setting.
    // pi core gates its own OSC 9;4 emission on this, but the extension
    // writes the escape sequence directly to stdout for Ghostty/tmux
    // passthrough — so we must mirror the gate here.
    if (piTuiSettings.showTerminalProgress === true) {
      // Send OSC 9;4 progress bar directly to Ghostty (via tmux passthrough if in tmux)
      emitOscProgress("\x1b]9;4;3\x1b\\");
      // Ghostty times out after ~15s; keepalive every 1s so the bar stays alive
      // during long streaming sessions (matching pi core's keepalive rate)
      if (!progressKeepalive) {
        progressKeepalive = setInterval(() => {
          emitOscProgress("\x1b]9;4;3\x1b\\");
        }, 1000);
        progressKeepalive.unref();
      }
    }
    startFooterAnim(ctx);
    scheduleRefresh(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    turnStartTime = Date.now();
    footer.turnElapsed = 0;
    currentCompletedTurnUsage = emptyUsageTokenMetrics();
    streamingTurnUsage = emptyUsageTokenMetrics();
    publishTurnUsage();
    scheduleRefresh(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    queue.onTurnEnd();
    scheduleRefresh(ctx, 100);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreUsageFromBranch(ctx);
    scheduleRefresh(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    restoreUsageFromBranch(ctx);
    scheduleRefresh(ctx);
  });

  pi.on("message_update", async (event, _ctx) => {
    if (turnStartTime > 0) {
      footer.turnElapsed = Date.now() - turnStartTime;
    }
    const streamEvent = event.assistantMessageEvent;
    const partialUsage = streamEvent.type === "done"
      ? streamEvent.message.usage
      : streamEvent.type === "error"
        ? streamEvent.error.usage
        : streamEvent.partial.usage;
    const metrics = usageTokenMetrics(partialUsage);
    if (hasUsageTokenMetrics(metrics)) {
      streamingTurnUsage = metrics;
      publishTurnUsage();
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role === "assistant" && event.message.usage) {
      const u = event.message.usage;
      const metrics = usageTokenMetrics(u);
      currentCompletedTurnUsage = addUsageTokenMetrics(currentCompletedTurnUsage, metrics);
      lastCompletedTurnUsage = currentCompletedTurnUsage;
      streamingTurnUsage = emptyUsageTokenMetrics();
      footer.tokenCount = metrics.total;
      publishTurnUsage();
      footer.totalCostUsd += usageCostUsd(u);
    }
    scheduleRefresh(ctx, 50);
  });

  pi.on("agent_end", async (_event, ctx) => {
    queue.onAgentEnd();
    footer.isStreaming = false;
    // Clear terminal progress bar (only matters if we were showing one)
    if (progressKeepalive) {
      clearInterval(progressKeepalive);
      progressKeepalive = null;
    }
    if (piTuiSettings.showTerminalProgress === true) {
      emitOscProgress("\x1b]9;4;0\x1b\\");
    }
    if (turnStartTime > 0) {
      footer.turnElapsed = Date.now() - turnStartTime;
    }
    turnStartTime = 0;
    stopFooterAnim(ctx);
    updateGit(ctx);
    refreshUI(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    if (ctx.model) {
      footer.modelLabel = modelLabel(ctx.model);
      footer.contextWindow = ctx.model.contextWindow ?? 0;
    }
    scheduleRefresh(ctx);
  });

  pi.on("thinking_level_select", async (event, _ctx) => {
    footer.thinkingLevel = event.level;
    currentEditor?.setThinkingLevel(event.level);
    if (streamPromptAnimTimer) {
      streamPromptAnimFrame = 0;
      const frames = streamingPromptFramesForThinkingLevel(event.level)
        ?? DEFAULT_STREAMING_PROMPT_FRAMES;
      setEditorStreamingPrompt(frames[0]);
    }
    if (footer.tui) footer.tui.requestRender();
  });

  // ── Fixed-editor command ─────────────────────────────────────────────────
  function toggleSidebar(ctx: ExtensionContext): void {
    sidebar.enabled = !sidebar.enabled;
    ctx.ui.notify(sidebar.enabled ? "Sidebar: ON" : "Sidebar: OFF", "info");
    compositor?.invalidateCluster();
    refreshUI(ctx);
    compositor?.requestRepaint();
  }

  pi.registerCommand("sidebar", {
    description: "Toggle right sidebar for TODOs, queue, git, and session context",
    handler: async (_args, ctx) => {
      toggleSidebar(ctx);
    },
  });

  // Note: was ctrl+shift+b — most terminals send the same byte
  // sequence for ctrl+b and ctrl+shift+b (shift is a no-op for
  // non-printable control chars), so the shortcut silently never
  // fired. f2 is unambiguous (\x1bOQ in xterm).
  pi.registerShortcut("f2", {
    description: "Toggle right sidebar",
    handler: async (ctx) => {
      toggleSidebar(ctx);
    },
  });

  pi.registerCommand("fixed-editor", {
    description:
      "Toggle fixed editor (sticky at bottom while scrolling messages)",
    handler: async (_args, ctx) => {
      fixedEditorEnabled = !fixedEditorEnabled;
      ctx.ui.notify(
        fixedEditorEnabled ? "Fixed editor: ON" : "Fixed editor: OFF",
        "info",
      );
      if (fixedEditorEnabled) {
        reconnectEditor(ctx);
      } else if (compositor) {
        compositor.dispose();
        compositor = null;
        reconnectEditor(ctx);
      }
      refreshUI(ctx);
    },
  });

  pi.registerCommand("fixed-editor-reset", {
    description: "Reset terminal modes used by the fixed editor compositor",
    handler: async (_args, ctx) => {
      if (compositor) {
        compositor.resetTerminalState();
      } else {
        const terminal = tuiRef?.terminal;
        if (terminal && typeof terminal.write === "function") {
          terminal.write(emergencyTerminalModeReset());
        }
      }
      ctx.ui.notify("Fixed editor terminal modes reset", "info");
    },
  });



  function reconnectEditor(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    ctx.ui.setEditorComponent((tui, theme, kb) => {
      tuiRef = tui;
      currentEditor?.dispose();
      currentEditor = new AmpBoxEditor(
        tui,
        theme,
        kb,
        ctx.ui.theme,
        piTuiSettings.editorPaddingX,
        footer.thinkingLevel,
      );
      currentEditor.setStreamingPrompt(editorStreamingPrompt);

      tryInitCompositor(tui, ctx);
      return currentEditor;
    });
  }


  function renderHiddenLines(
    renderable: any,
    width: number,
    filterBlank = false,
  ): string[] {
    if (!renderable || !compositor) return [];
    const lines = compositor.renderHidden(renderable, width);
    return filterBlank ? lines.filter((line) => visibleWidth(line) > 0) : lines;
  }

  function syncFixedRenderables(repaint = true): void {
    if (!fixedEditorEnabled || !compositor || !tuiRef || !currentEditor) return;

    const editorContainerMatch = findRenderableContainerWithChild(
      tuiRef,
      currentEditor,
    );
    if (!editorContainerMatch) {
      console.error(
        "[pikit-tui] Fixed editor mode disabled: render tree does not contain the expected editor container. This typically means the Pi runtime render-tree structure has changed. Disabling fixed mode to prevent broken layout.",
      );
      fixedEditorEnabled = false;
      compositor.dispose();
      return;
    }

    const children = Array.isArray(tuiRef.children) ? tuiRef.children : [];

    const nextEditorContainer = editorContainerMatch.container;
    const nextStatusContainer = isRenderable(
      children[editorContainerMatch.index - 2],
    )
      ? children[editorContainerMatch.index - 2]
      : null;
    const nextQueueContainer = isRenderable(
      children[editorContainerMatch.index - 3],
    )
      ? children[editorContainerMatch.index - 3]
      : null;
    const nextWidgetContainerAbove = isRenderable(
      children[editorContainerMatch.index - 1],
    )
      ? children[editorContainerMatch.index - 1]
      : null;
    const nextWidgetContainerBelow = isRenderable(
      children[editorContainerMatch.index + 1],
    )
      ? children[editorContainerMatch.index + 1]
      : null;
    const nextFooterContainer = isRenderable(
      children[editorContainerMatch.index + 2],
    )
      ? children[editorContainerMatch.index + 2]
      : null;
    const changed =
      fixedEditorContainer !== nextEditorContainer ||
      fixedStatusContainer !== nextStatusContainer ||
      fixedQueueContainer !== nextQueueContainer ||
      fixedWidgetContainerAbove !== nextWidgetContainerAbove ||
      fixedWidgetContainerBelow !== nextWidgetContainerBelow ||
      fixedFooterContainer !== nextFooterContainer;

    fixedEditorContainer = nextEditorContainer;
    fixedStatusContainer = nextStatusContainer;
    fixedQueueContainer = nextQueueContainer;
    fixedWidgetContainerAbove = nextWidgetContainerAbove;
    fixedWidgetContainerBelow = nextWidgetContainerBelow;
    fixedFooterContainer = nextFooterContainer;

    compositor.retainHiddenRenderables([
      fixedStatusContainer,
      fixedQueueContainer,
      fixedWidgetContainerAbove,
      fixedEditorContainer,
      fixedWidgetContainerBelow,
      fixedFooterContainer,
    ]);

    if (fixedStatusContainer) compositor.hideRenderable(fixedStatusContainer);
    if (fixedQueueContainer) compositor.hideRenderable(fixedQueueContainer);
    if (fixedWidgetContainerAbove)
      compositor.hideRenderable(fixedWidgetContainerAbove);
    if (fixedEditorContainer) compositor.hideRenderable(fixedEditorContainer);
    if (fixedWidgetContainerBelow)
      compositor.hideRenderable(fixedWidgetContainerBelow);
    if (fixedFooterContainer) compositor.hideRenderable(fixedFooterContainer);
    if (changed) compositor.invalidateCluster();
    if (changed && repaint) compositor.requestRepaint();
  }

  /** Initialize the compositor if all conditions are met. */
  function tryInitCompositor(tui: any, ctx: ExtensionContext) {
    if (!fixedEditorEnabled) return;
    if (!currentEditor) return;

    const terminal = (tui as any).terminal;
    if (!terminal || typeof terminal.write !== "function") return;

    // If compositor already exists but the TUI changed (e.g., session
    // resume: setEditorComponent fires again with a fresh tui object),
    // the old input listener is bound to the old TUI and never fires
    // on the new one. Dispose and recreate so the listener moves.
    if (compositor && (compositor as unknown as { tui: unknown }).tui !== tui) {
      compositor.dispose();
      compositor = null;
    }

    // If compositor already exists, re-discover containers for the new editor/footer.
    if (compositor) {
      syncFixedRenderables();
      return;
    }

    compositor = new FixedEditorCompositor(tui, terminal, {
      getEditorLines: (width: number) => {
        if (fixedEditorContainer)
          return renderHiddenLines(fixedEditorContainer, width);
        if (!currentEditor) return [];
        return (
          compositor?.renderHidden(currentEditor, width) ??
          currentEditor.render(width)
        );
      },
      getEditorText: () => currentEditor?.getText() ?? "",
      getStatusLines: (width: number) => {
        // Sync first so fixedStatusContainer is resolved before we render.
        // The above/below hooks do this too — we must not be the odd one out,
        // otherwise the first status render returns [] because the reference
        // is still null.
        syncFixedRenderables(false);
        const lines = renderHiddenLines(fixedStatusContainer, width, true);
        const pad = workingStatusSpacerLines(piTuiSettings.workingPaddingTop ?? 1);
        return pad.length > 0 ? [...pad, ...lines] : lines;
      },
      getAboveWidgetLines: (width: number) => {
        syncFixedRenderables(false);
        const queueLines = renderHiddenLines(fixedQueueContainer, width);
        const widgetLines = renderHiddenLines(fixedWidgetContainerAbove, width);
        return [...queueLines, ...widgetLines];
      },
      getBelowWidgetLines: (width: number) => {
        syncFixedRenderables(false);
        return renderHiddenLines(fixedWidgetContainerBelow, width);
      },
      getFooterLines: (width: number) =>
        renderHiddenLines(fixedFooterContainer, width, true),
      getSidebarWidth: (terminalWidth: number) => sidebarTotalWidth(sidebar, terminalWidth),
      getSidebarLines: (width: number, height: number) => renderSidebar(sidebar, width, height, {
        subtext: (text) => ctx.ui.theme.fg("dim", text),
        label: (text) => ctx.ui.theme.fg("accent", text),
        success: (text) => ctx.ui.theme.fg("success", text),
        error: (text) => ctx.ui.theme.fg("error", text),
        warning: (text) => ctx.ui.theme.fg("warning", text),
      }),
      getShowHardwareCursor: () =>
        typeof tui.getShowHardwareCursor === "function" &&
        tui.getShowHardwareCursor(),
      isStreaming: () => footer.isStreaming,
      keyboardScrollShortcuts: piTuiSettings.keyboardScrollShortcuts,
      onCopySelection: async (text: string) => {
        await copyToClipboard(text).catch(() => {
          ctx.ui.setStatus("tui-copy", "Clipboard copy failed");
          if (clipboardStatusTimer) clearTimeout(clipboardStatusTimer);
          clipboardStatusTimer = setTimeout(() => {
            ctx.ui.setStatus("tui-copy", undefined);
            clipboardStatusTimer = null;
          }, 2500);
          clipboardStatusTimer.unref?.();
        });
      },
    });

        try {
          compositor.install();
        } catch (error) {
          compositor = null;
          fixedEditorEnabled = false;
          ctx.ui.notify(
            `[pi-tui] Failed to install compositor: ${String(error)}`,
            "error",
          );
          return;
        }
        syncFixedRenderables();
  }

  // ── Tool results ─────────────────────────────────────────────────────────
  pi.on("tool_result", async (event, ctx) => {
    if (isWriteToolResult(event) || isEditToolResult(event) || isBashToolResult(event)) {
      invalidateGitStatus();
      updateGit(ctx);
    }
    if (isWriteToolResult(event) || isEditToolResult(event)) {
      const path = typeof event.input.path === "string" ? event.input.path : "";
      if (path.toLowerCase().includes("todo.md")) {
        refreshTodosWithNotify(
          ctx.cwd,
          isEditToolResult(event) ? "edit" : "write",
          ctx,
        );
        scheduleRefresh(ctx);
      }
    } else if (isBashToolResult(event)) {
      // Bash can edit TODO.md via `cat >>`, `sed -i`, `tee`, `python -c`, etc.
      // Catches anything with "todo.md" (case-insensitive) in the command.
      const cmd = typeof event.input.command === "string" ? event.input.command : "";
      if (cmd.toLowerCase().includes("todo.md")) {
        refreshTodosWithNotify(ctx.cwd, "bash", ctx);
        scheduleRefresh(ctx);
      }
    }
  });
}
