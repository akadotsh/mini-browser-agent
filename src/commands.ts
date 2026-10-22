import { extname, isAbsolute, relative, resolve } from "node:path";
import { homedir } from "node:os";

export type Instruction = { action: string; value: string };
export type Target = { kind: "ref" | "css"; value: string };

export function parseInstruction(input: string): Instruction {
  const trimmed = input.trim();
  const space = trimmed.indexOf(" ");
  return space === -1
    ? { action: trimmed.toLowerCase(), value: "" }
    : { action: trimmed.slice(0, space).toLowerCase(), value: trimmed.slice(space + 1).trim() };
}

export function splitFirst(value: string): [string, string] {
  const space = value.indexOf(" ");
  return space === -1 ? [value, ""] : [value.slice(0, space), value.slice(space + 1)];
}

export function normalizeUrl(value: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  return url.href;
}

export function parseTarget(value: string): Target {
  if (/^e\d+$/.test(value)) return { kind: "ref", value };
  if (value.startsWith("css:") && value.length > 4) return { kind: "css", value: value.slice(4) };
  throw new Error('Target must be an element ref such as "e1" or start with "css:"');
}

export function screenshotDirectory(home = homedir()): string {
  return resolve(home, "Mini Browser Agent", "Screenshots");
}

export type ScreenshotFormat = "png" | "jpeg" | "webp";

export function resolveScreenshotPath(value: string, root = screenshotDirectory()): { absolute: string; relative: string; format: ScreenshotFormat } {
  const requested = value || `${Date.now()}.png`;
  if (isAbsolute(requested)) throw new Error("Screenshot path must be relative");
  const extension = extname(requested).toLowerCase();
  const format = extension === ".png" ? "png" : extension === ".jpg" || extension === ".jpeg" ? "jpeg" : extension === ".webp" ? "webp" : undefined;
  if (!format) throw new Error("Screenshot path must end with .png, .jpg, .jpeg, or .webp");
  const absolute = resolve(root, requested);
  const fromRoot = relative(root, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Screenshot path must stay inside the screenshot directory");
  }
  return { absolute, relative: fromRoot, format };
}
