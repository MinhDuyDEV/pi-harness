/**
 * DeepSeek provider registration smoke test.
 *
 * Verifies the DeepSeek provider registers a valid ProviderConfig contract
 * compatible with installed Pi 0.81.1, without network access or credentials.
 *
 * TDD approach: test first, see it fail for a missing contract if behavior
 * needs production change.
 */

import { describe, it, expect } from "bun:test";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { DeepseekProviderApi } from "../deepseek-provider.ts";

describe("DeepSeek provider registration", () => {
  it("registers provider contract matching Pi 0.81.1", async () => {
    // Track what was passed to registerProvider
    let registeredName: string | undefined;
    let registeredConfig: ProviderConfig | undefined;
    let registerCalls = 0;

    const mockApi: DeepseekProviderApi = {
      registerProvider(name, config) {
        registerCalls += 1;
        registeredName = name;
        registeredConfig = config;
      },
    };

    // Import the provider module default export
    const { default: registerDeepSeek } = await import("../deepseek-provider.ts");

    // Act: register
    registerDeepSeek(mockApi);

    // Assert: registration contract
    expect(registeredName).toBe("deepseek");
    expect(registeredConfig).toBeDefined();

    // -- ProviderConfig shape assertions --
    // name (display name)
    expect(registeredConfig!.name).toBe("DeepSeek");

    // baseUrl
    expect(registeredConfig!.baseUrl).toBe("https://api.deepseek.com");

    // apiKey must be a string (may be empty/placeholder in this smoke context)
    expect(typeof registeredConfig!.apiKey).toBe("string");

    // api must be a non-empty string referencing a registered API type
    expect(typeof registeredConfig!.api).toBe("string");
    expect(registeredConfig!.api!.length).toBeGreaterThan(0);

    // authHeader should be boolean true
    expect(registeredConfig!.authHeader).toBe(true);

    // models must be a non-empty array of ProviderModelConfig objects
    expect(Array.isArray(registeredConfig!.models)).toBe(true);
    expect(registeredConfig!.models!.length).toBeGreaterThan(0);

    // Each model entry must have at minimum an id string
    for (const model of registeredConfig!.models!) {
      expect(model).toBeDefined();
      expect(typeof model).toBe("object");
      expect(typeof model.id).toBe("string");
      expect(model.id!.length).toBeGreaterThan(0);
    }

    // streamSimple must be a function
    expect(typeof registeredConfig!.streamSimple).toBe("function");

    // registerProvider must have been called exactly once
    expect(registerCalls).toBe(1);
  });
});
