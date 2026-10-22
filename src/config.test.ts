import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configFilePath, loadStoredConfig, saveStoredConfig } from "./config";
import { readAgentConfig } from "./agent";

describe("configuration", () => {
  test("uses platform-standard paths", () => {
    expect(configFilePath("darwin", {}, "/home/me")).toBe("/home/me/Library/Application Support/Mini Browser Agent/config.json");
    expect(configFilePath("linux", {}, "/home/me")).toBe("/home/me/.config/mini-browser-agent/config.json");
    expect(configFilePath("win32", { APPDATA: "C:\\Config" }, "C:\\Users\\me")).toContain("Mini Browser Agent/config.json");
  });

  test("saves, loads, and restricts configuration permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mini-browser-config-"));
    const path = join(directory, "nested", "config.json");
    await saveStoredConfig({ model: "gpt-oss:120b", apiKey: "secret", maxSteps: 12 }, path);
    expect(await loadStoredConfig(path)).toEqual({ model: "gpt-oss:120b", apiKey: "secret", maxSteps: 12 });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    await chmod(path, 0o600);
  });

  test("environment variables override stored values", () => {
    expect(readAgentConfig({ AI_MODEL: "env-model", AI_BASE_URL: "https://env.test/v1", AI_MAX_STEPS: "5" }, { model: "stored-model", baseURL: "https://stored.test/v1", maxSteps: 10 })).toMatchObject({ model: "env-model", baseURL: "https://env.test/v1", maxSteps: 5 });
  });
});
