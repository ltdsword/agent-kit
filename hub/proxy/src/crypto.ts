import { LIMITS } from "../../protocol/src/api.ts";

const encoder = new TextEncoder();
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const FIELD = (1n << 255n) - 19n;
const CURVE_D = mod(-121665n * pow(121666n, FIELD - 2n));
const BASE_POINT: Point = {
  x: 15112221349535400772501151409588531511454012693041857206046113283949847762202n,
  y: 4n * pow(5n, FIELD - 2n) % FIELD,
  z: 1n,
  t: 0n,
};
BASE_POINT.t = BASE_POINT.x * BASE_POINT.y % FIELD;

type Point = { x: bigint; y: bigint; z: bigint; t: bigint };

export type PasswordHash = { hash: string; salt: string; iterations: number };
export type AssertionPayload = { v: 1; sub: string; cid: string; rid: string; exp: number };

function mod(value: bigint): bigint {
  const result = value % FIELD;
  return result < 0n ? result + FIELD : result;
}

function pow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = result * factor % FIELD;
    factor = factor * factor % FIELD;
    remaining >>= 1n;
  }
  return result;
}

function addPoints(left: Point, right: Point): Point {
  const a = mod((left.y - left.x) * (right.y - right.x));
  const b = mod((left.y + left.x) * (right.y + right.x));
  const c = mod(2n * CURVE_D * left.t * right.t);
  const d = mod(2n * left.z * right.z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return {
    x: mod(e * f),
    y: mod(g * h),
    t: mod(e * h),
    z: mod(f * g),
  };
}

function doublePoint(point: Point): Point {
  const a = mod(point.x * point.x);
  const b = mod(point.y * point.y);
  const c = mod(2n * point.z * point.z);
  const d = mod(-a);
  const e = mod((point.x + point.y) * (point.x + point.y) - a - b);
  const g = mod(d + b);
  const f = mod(g - c);
  const h = mod(d - b);
  return {
    x: mod(e * f),
    y: mod(g * h),
    t: mod(e * h),
    z: mod(f * g),
  };
}

function littleEndian(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function readLittleEndian(value: Uint8Array): bigint {
  let result = 0n;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[index]);
  }
  return result;
}

export function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function constantTimeEqualText(left: string, right: string): boolean {
  return constantTimeEqual(encoder.encode(left), encoder.encode(right));
}

export async function sha256(value: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  return Array.from(await sha256(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)), iterations: number = LIMITS.pbkdf2Iterations): Promise<PasswordHash> {
  const saltBytes = Uint8Array.from(salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" }, key, 256);
  return { hash: encodeBase64Url(new Uint8Array(bits)), salt: encodeBase64Url(saltBytes), iterations };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string, iterations: number): Promise<boolean> {
  try {
    const actual = await hashPassword(password, decodeBase64Url(salt), iterations);
    return constantTimeEqual(decodeBase64Url(actual.hash), decodeBase64Url(expectedHash));
  } catch {
    return false;
  }
}

export function randomToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function randomPassword(length = 20): string {
  let result = "";
  const ceiling = Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length;
  while (result.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length - result.length + 8))) {
      if (byte >= ceiling) continue;
      result += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (result.length === length) break;
    }
  }
  return result;
}

export function randomBase32(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length * 5 / 8)));
  let bits = 0;
  let accumulator = 0;
  let result = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5 && result.length < length) {
      bits -= 5;
      result += BASE32[(accumulator >> bits) & 31];
    }
    if (result.length === length) break;
  }
  return result;
}

function privateSeed(pkcs8: Uint8Array): Uint8Array {
  const prefix = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
  if (pkcs8.length !== prefix.length + 32 || prefix.some((byte, index) => pkcs8[index] !== byte)) {
    throw new Error("SIGNING_KEY must be an Ed25519 PKCS8 private key.");
  }
  return pkcs8.slice(prefix.length);
}

export async function derivePublicKey(pkcs8: Uint8Array): Promise<Uint8Array> {
  const seed = privateSeed(pkcs8);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", Uint8Array.from(seed)));
  const scalarBytes = digest.slice(0, 32);
  scalarBytes[0] &= 248;
  scalarBytes[31] &= 63;
  scalarBytes[31] |= 64;
  const scalar = readLittleEndian(scalarBytes);

  let result: Point = { x: 0n, y: 1n, z: 1n, t: 0n };
  let point: Point = { ...BASE_POINT };
  for (let bit = 0; bit < 256; bit += 1) {
    if (((scalar >> BigInt(bit)) & 1n) === 1n) result = addPoints(result, point);
    point = doublePoint(point);
  }

  const inverseZ = pow(result.z, FIELD - 2n);
  const x = mod(result.x * inverseZ);
  const y = mod(result.y * inverseZ);
  const encoded = littleEndian(y, 32);
  encoded[31] |= Number(x & 1n) << 7;
  return encoded;
}

export async function signAssertion(
  signingKey: string,
  subject: string,
  computerId: string,
  requestId: string,
): Promise<{ assertion: string; publicKey: string; payload: AssertionPayload }> {
  const privateKeyBytes = decodeBase64Url(signingKey);
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(privateKeyBytes), { name: "Ed25519" } as AlgorithmIdentifier, false, ["sign"]);
  const payload: AssertionPayload = {
    v: 1,
    sub: subject,
    cid: computerId,
    rid: requestId,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("Ed25519" as AlgorithmIdentifier, key, encoder.encode(encodedPayload));
  return {
    assertion: `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`,
    publicKey: encodeBase64Url(await derivePublicKey(privateKeyBytes)),
    payload,
  };
}
