/**
 * AIClient — HTTP client for LLM API calls (OpenAI-compatible).
 *
 * Handles API key management (localStorage), model selection,
 * temperature, request/response, and error handling.
 */

const STORAGE_KEY_API_KEY = 'retro-gamemaker-ai-api-key';
const STORAGE_KEY_MODEL = 'retro-gamemaker-ai-model';
const STORAGE_KEY_TEMP = 'retro-gamemaker-ai-temperature';

export const AI_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o (best)' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast)' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (economy)' },
];

export interface AIConfig {
  apiKey: string;
  model: string;
  temperature: number;
}

export class AIClient {
  /** Get the stored API key, or empty string. */
  static getAPIKey(): string {
    return localStorage.getItem(STORAGE_KEY_API_KEY) ?? '';
  }

  /** Store the API key. */
  static setAPIKey(key: string): void {
    localStorage.setItem(STORAGE_KEY_API_KEY, key);
  }

  /** Get the stored model, or default. */
  static getModel(): string {
    return localStorage.getItem(STORAGE_KEY_MODEL) ?? AI_MODELS[0].id;
  }

  /** Store the model. */
  static setModel(model: string): void {
    localStorage.setItem(STORAGE_KEY_MODEL, model);
  }

  /** Get the stored temperature, or default. */
  static getTemperature(): number {
    const stored = localStorage.getItem(STORAGE_KEY_TEMP);
    return stored ? parseFloat(stored) : 0.8;
  }

  /** Store the temperature. */
  static setTemperature(temp: number): void {
    localStorage.setItem(STORAGE_KEY_TEMP, String(temp));
  }

  /** Get the current config from storage. */
  static getConfig(): AIConfig {
    return {
      apiKey: AIClient.getAPIKey(),
      model: AIClient.getModel(),
      temperature: AIClient.getTemperature(),
    };
  }

  /** Check if the API is configured (has a key). */
  static isConfigured(): boolean {
    return AIClient.getAPIKey().length > 0;
  }

  /**
   * Send a chat completion request to the OpenAI-compatible API.
   * @param systemPrompt  System message content
   * @param userPrompt    User message content
   * @param abortSignal   Optional AbortSignal for cancellation
   * @returns The response text content
   */
  static async generate(
    systemPrompt: string,
    userPrompt: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const config = AIClient.getConfig();

    if (!config.apiKey) {
      throw new Error('API key not configured. Set your API key in AI Settings.');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: config.temperature,
        response_format: { type: 'json_object' },
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      let message = `API error (${response.status})`;
      try {
        const err = JSON.parse(errorBody);
        message = err.error?.message ?? message;
      } catch {}
      throw new Error(message);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from API');
    }
    return content;
  }
}
