import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const storedConfigSchema = z.object({
  baseURL: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
});

export type StoredConfig = z.infer<typeof storedConfigSchema>;

export function configFilePath(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Mini Browser Agent", "config.json");
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Mini Browser Agent", "config.json");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "mini-browser-agent", "config.json");
}

export async function loadStoredConfig(path = configFilePath()): Promise<StoredConfig> {
  try {
    return storedConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read configuration: ${error instanceof Error ? error.message : error}`);
  }
}

export async function saveStoredConfig(config: StoredConfig, path = configFilePath()) {
  const directory = dirname(path);
  const temporary = `${path}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(storedConfigSchema.parse(config), null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}
