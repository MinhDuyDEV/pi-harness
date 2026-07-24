import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { createHash, randomBytes, randomUUID } from "crypto";
import { createServer, type Server } from "http";
import {
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DISCOVERY_URL,
  XAI_OAUTH_REDIRECT_HOST,
  XAI_OAUTH_REDIRECT_PATH,
  XAI_OAUTH_REDIRECT_PORT,
  XAI_OAUTH_REFRESH_SKEW_MS,
  XAI_OAUTH_SCOPE,
} from "./constants";

type XaiDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
};

type XaiTokenPayload = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

type CallbackResult = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  trustedManualCode?: boolean;
};

type XaiOAuthOptions = {
  getExistingCredentials: () => OAuthCredentials | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function validateXaiEndpoint(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || (host !== "x.ai" && !host.endsWith(".x.ai"))) {
    throw new Error(`xAI OAuth discovery returned an unexpected endpoint: ${url}`);
  }
  return url;
}

async function xaiDiscovery(): Promise<XaiDiscovery> {
  const response = await fetch(XAI_OAUTH_DISCOVERY_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`xAI OAuth discovery failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as Partial<XaiDiscovery>;
  if (!data.authorization_endpoint || !data.token_endpoint) {
    throw new Error("xAI OAuth discovery response did not include authorization/token endpoints");
  }

  return {
    authorization_endpoint: validateXaiEndpoint(data.authorization_endpoint),
    token_endpoint: validateXaiEndpoint(data.token_endpoint),
  };
}

function callbackCorsOrigin(origin: string | undefined): string | undefined {
  return origin === "https://accounts.x.ai" || origin === "https://auth.x.ai" ? origin : undefined;
}

/** Refresh xAI OAuth credentials using their refresh token. */
export async function refreshXaiCredentials(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (!credentials.refresh) {
    throw new Error("xAI credentials are expired and do not include a refresh token");
  }

  const tokenEndpoint =
    typeof credentials.tokenEndpoint === "string" && credentials.tokenEndpoint
      ? validateXaiEndpoint(credentials.tokenEndpoint)
      : (await xaiDiscovery()).token_endpoint;
  const data = await exchangeXaiToken(tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: credentials.refresh,
    client_id: XAI_OAUTH_CLIENT_ID,
  });

  return credentialsFromTokenPayload(data, tokenEndpoint, credentials.refresh);
}

/** Return credentials as-is when fresh, otherwise refresh them. */
export async function ensureFreshXaiCredentials(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (!credentials.expires || credentials.expires > Date.now()) return credentials;
  return refreshXaiCredentials(credentials);
}

type CallbackServerHandle = {
  redirectUri: string;
  waitForCallback: (signal?: AbortSignal) => Promise<CallbackResult>;
  resolveCallback: (result: CallbackResult) => void;
  close: () => void;
};

async function startCallbackServer(expectedState: string): Promise<CallbackServerHandle> {
  let resolveCallback!: (result: CallbackResult) => void;
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve;
  });
  const server = await listenCallbackServer(() => createCallbackHttpServer(expectedState, resolveCallback));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not determine xAI OAuth callback port");
  }
  const close = () => closeServer(server);
  return {
    redirectUri: `http://${XAI_OAUTH_REDIRECT_HOST}:${address.port}${XAI_OAUTH_REDIRECT_PATH}`,
    close,
    resolveCallback,
    waitForCallback: (signal) => waitForCallback(callbackPromise, close, signal),
  };
}

function createCallbackHttpServer(expectedState: string, resolveCallback: (result: CallbackResult) => void): Server {
  return createServer((request, response) => {
    const origin = callbackCorsOrigin(request.headers.origin);
    if (request.method === "OPTIONS") {
      writeCorsHeaders(response, origin);
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url || "/", `http://${XAI_OAUTH_REDIRECT_HOST}`);
    if (url.pathname !== XAI_OAUTH_REDIRECT_PATH) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const result = callbackResultFromUrl(url);
    if (result.state !== expectedState) {
      writeCorsHeaders(response, origin);
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<html><body><h1>xAI authorization state mismatch.</h1>Please return to pi and try again.</body></html>");
      return;
    }
    resolveCallback(result);
    writeCorsHeaders(response, origin);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.error
      ? "<html><body><h1>xAI authorization failed.</h1>You can close this tab.</body></html>"
      : "<html><body><h1>xAI authorization received.</h1>You can close this tab.</body></html>");
  });
}

function callbackResultFromUrl(url: URL): CallbackResult {
  return {
    code: url.searchParams.get("code") || undefined,
    state: url.searchParams.get("state") || undefined,
    error: url.searchParams.get("error") || undefined,
    error_description: url.searchParams.get("error_description") || undefined,
  };
}

function writeCorsHeaders(response: import("http").ServerResponse, origin: string | undefined): void {
  if (!origin) return;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Vary", "Origin");
}

async function listenCallbackServer(makeServer: () => Server): Promise<Server> {
  try {
    return await listenOnPort(makeServer(), XAI_OAUTH_REDIRECT_PORT);
  } catch {
    return listenOnPort(makeServer(), 0);
  }
}

function listenOnPort(server: Server, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, XAI_OAUTH_REDIRECT_HOST, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): void {
  try {
    server.close();
  } catch {
    return;
  }
}

async function waitForCallback(
  callbackPromise: Promise<CallbackResult>,
  close: () => void,
  signal?: AbortSignal,
): Promise<CallbackResult> {
  let timer: NodeJS.Timeout | undefined;
  let abortHandler: (() => void) | undefined;
  const timeout = new Promise<CallbackResult>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out waiting for xAI OAuth callback")), 180_000);
    abortHandler = () => reject(new Error("xAI OAuth login was cancelled"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([callbackPromise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    close();
  }
}

function buildAuthorizeUrl(discovery: XaiDiscovery, redirectUri: string, challenge: string, state: string, nonce: string): string {
  // Match the official Grok CLI authorize URL. Extra query params such as
  // `plan=generic` can change xAI's routing/branding and send users toward
  // the API-console SSO surface instead of the Grok OAuth consent surface.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XAI_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: XAI_OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

function parseCallbackInput(input: string): CallbackResult | undefined {
  const value = input.trim();
  if (!value) return undefined;

  // xAI may show only the authorization code when localhost redirect fails,
  // especially when pi runs in WSL and the browser runs on Windows.
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return { code: value, trustedManualCode: true };

  try {
    const url = value.startsWith("http")
      ? new URL(value)
      : new URL(`http://${XAI_OAUTH_REDIRECT_HOST}${XAI_OAUTH_REDIRECT_PATH}?${value.replace(/^\?/, "")}`);
    return {
      code: url.searchParams.get("code") || undefined,
      state: url.searchParams.get("state") || undefined,
      error: url.searchParams.get("error") || undefined,
      error_description: url.searchParams.get("error_description") || undefined,
    };
  } catch {
    return undefined;
  }
}

async function exchangeXaiToken(tokenEndpoint: string, body: Record<string, string>): Promise<XaiTokenPayload> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    throw new Error(`xAI token request failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as XaiTokenPayload;
}

function credentialsFromTokenPayload(data: XaiTokenPayload, tokenEndpoint: string, fallbackRefresh = ""): OAuthCredentials {
  if (!data.access_token) {
    throw new Error("xAI token response did not include an access token");
  }

  const refresh = data.refresh_token || fallbackRefresh;
  if (!refresh) {
    throw new Error("xAI token response did not include a refresh token");
  }

  return {
    refresh,
    access: data.access_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000 - XAI_OAUTH_REFRESH_SKEW_MS,
    tokenEndpoint,
    idToken: data.id_token || "",
    tokenType: data.token_type || "Bearer",
  };
}

export function createXaiOAuth({ getExistingCredentials }: XaiOAuthOptions) {
  return {
    usesCallbackServer: true,
    name: "xAI (Grok)",
    login: (callbacks: OAuthLoginCallbacks) => loginXai(callbacks, getExistingCredentials),
    async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
      if (!credentials.refresh && credentials.expires && credentials.expires <= Date.now()) {
        throw new Error("xAI OAuth token is expired and cannot be refreshed. Please run /login xai-auth again.");
      }
      return credentials.refresh ? refreshXaiCredentials(credentials) : credentials;
    },
    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    },
  };
}

async function loginXai(
  callbacks: OAuthLoginCallbacks,
  getExistingCredentials: () => OAuthCredentials | null,
): Promise<OAuthCredentials> {
  const existing = await promptForExistingCredentials(callbacks, getExistingCredentials());
  if (existing) return existing;
  callbacks.onProgress?.("Starting xAI SuperGrok OAuth login...");
  const discovery = await xaiDiscovery();
  const { verifier, challenge } = pkcePair();
  const state = randomUUID().replace(/-/g, "");
  const nonce = randomUUID().replace(/-/g, "");
  const callbackServer = await startCallbackServer(state);
  callbacks.onAuth?.({
    url: buildAuthorizeUrl(discovery, callbackServer.redirectUri, challenge, state, nonce),
    instructions: "If the automatic open uses the wrong browser/profile, copy the URL and paste it into the field below (or open it manually in your preferred browser).",
  });
  callbacks.onProgress?.(`Waiting for xAI OAuth callback on ${callbackServer.redirectUri}...`);
  attachManualCodeInput(callbacks, callbackServer, state);
  const callback = await callbackServer.waitForCallback(callbacks.signal);
  validateAuthorizationCallback(callback, state);
  callbacks.onProgress?.("Exchanging xAI authorization code...");
  const data = await exchangeXaiToken(discovery.token_endpoint, {
    grant_type: "authorization_code",
    code: callback.code!,
    redirect_uri: callbackServer.redirectUri,
    client_id: XAI_OAUTH_CLIENT_ID,
    code_verifier: verifier,
  });
  return credentialsFromTokenPayload(data, discovery.token_endpoint);
}

async function promptForExistingCredentials(
  callbacks: OAuthLoginCallbacks,
  credentials: OAuthCredentials | null,
): Promise<OAuthCredentials | null> {
  if (!credentials) return null;
  const response = await callbacks.onPrompt({
    message: "Found existing official Grok CLI credentials in ~/.grok/auth.json. Use them instead of opening a new xAI OAuth login? (y/n)",
  });
  if (!response.toLowerCase().startsWith("y")) return null;
  try {
    return await ensureFreshXaiCredentials(credentials);
  } catch (error) {
    callbacks.onProgress?.(`Existing Grok CLI credentials could not be refreshed (${messageFromError(error)}). Starting a fresh xAI OAuth login...`);
    return null;
  }
}

function attachManualCodeInput(
  callbacks: OAuthLoginCallbacks,
  callbackServer: CallbackServerHandle,
  state: string,
): void {
  callbacks.onManualCodeInput?.().then((input: string) => {
    if (!input) return;
    const manual = parseCallbackInput(input);
    if (manual?.trustedManualCode || manual?.state === state || manual?.error) {
      callbackServer.resolveCallback(manual);
    } else if (manual) {
      callbacks.onProgress?.("Ignored pasted xAI callback because the OAuth state did not match. Try the login again if needed.");
    }
  }).catch(() => undefined);
}

function validateAuthorizationCallback(callback: CallbackResult, expectedState: string): asserts callback is CallbackResult & { code: string } {
  if (callback.error) throw new Error(`xAI authorization failed: ${callback.error_description || callback.error}`);
  if (!callback.trustedManualCode && callback.state !== expectedState) throw new Error("xAI authorization failed: state mismatch");
  if (!callback.code) throw new Error("xAI authorization failed: no authorization code returned");
}
