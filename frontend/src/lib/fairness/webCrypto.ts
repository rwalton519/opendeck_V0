/**
 * Thin wrappers around window.crypto.subtle used by both verifier ports
 * (demoVerifier.ts, practiceVerifier.ts). Everything here runs entirely in
 * the browser - the point of this whole feature is that the fairness check
 * does NOT depend on trusting anything the server says about itself.
 */

const utf8 = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** sha256(utf8(input)) - matches Node's crypto.createHash('sha256').update(input, 'utf8'). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(input));
  return bytesToHex(digest);
}

/**
 * HMAC-SHA256(key, message) -> raw bytes, both key and message treated as
 * UTF-8 strings - matches Node's crypto.createHmac('sha256', key).update(message).digest(),
 * where a string key/message is implicitly UTF-8 encoded.
 */
export async function hmacSha256Bytes(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    utf8.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, utf8.encode(message));
  return new Uint8Array(sig);
}

/** Reads a big-endian uint32 out of a byte array at the given offset. */
export function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}
