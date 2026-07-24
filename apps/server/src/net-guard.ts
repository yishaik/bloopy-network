import { lookup, type LookupAddress } from "node:dns";
import { lookup as lookupAsync } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { config } from "./config.js";
import { AppError } from "./errors.js";

export function isLoopbackAddress(address: string): boolean {
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  return ip === "::1" || ip.startsWith("127.");
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const a = parts[0] as number;
    const b = parts[1] as number;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const lower = ip.toLowerCase();
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

function isBlockedAddress(address: string): boolean {
  if (config.ALLOW_LOCAL_AI && isLoopbackAddress(address)) return false;
  return isPrivateAddress(address);
}

const blockedEndpoint = () => new AppError("ai_url_blocked", 400, "That endpoint points at a private or internal network, which is not allowed.");

export async function assertSafeAIBaseUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new AppError("ai_url_invalid", 400, "That endpoint is not a valid URL."); }
  if (url.username || url.password) throw new AppError("ai_url_invalid", 400, "AI endpoint URLs cannot embed credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const localOk = config.ALLOW_LOCAL_AI && (host === "localhost" || isLoopbackAddress(host));
  if (url.protocol !== "https:" && !localOk) throw new AppError("ai_url_https", 400, "AI endpoints must use HTTPS.");
  if (localOk) return url;
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw blockedEndpoint();
    return url;
  }
  let addresses: LookupAddress[];
  try { addresses = await lookupAsync(host, { all: true }); } catch { throw new AppError("ai_url_unresolvable", 400, "That endpoint's hostname does not resolve."); }
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) throw blockedEndpoint();
  return url;
}

// Re-checks DNS at connect time so a hostname validated at save time cannot rebind to an internal address later.
const guardedLookup = (hostname: string, options: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((entry) => isBlockedAddress(entry.address))) return callback(Object.assign(new Error("AI endpoint resolves to a blocked network"), { code: "EAIBLOCKED" }));
    if (options.all) return callback(null, list);
    callback(null, (list[0] as LookupAddress).address, (list[0] as LookupAddress).family);
  });
};

const guardedAgent = new Agent({ connect: { lookup: guardedLookup as never } });

export function aiFetch(url: string, init: NonNullable<Parameters<typeof undiciFetch>[1]>) {
  return undiciFetch(url, { ...init, dispatcher: guardedAgent });
}
