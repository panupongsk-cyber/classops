import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

function decodeKey(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Outbox encryption key must contain 32 bytes");
  return key;
}

export function encryptMailPayload(payload: Record<string, unknown>, encodedKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, decodeKey(encodedKey), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return [iv, authenticationTag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptMailPayload(encryptedPayload: string, encodedKey: string) {
  const parts = encryptedPayload.split(".");
  if (parts.length !== 3) throw new Error("Encrypted outbox payload has an invalid format");
  const [encodedIv, encodedTag, encodedCiphertext] = parts;
  if (!encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Encrypted outbox payload is incomplete");
  }
  const decipher = createDecipheriv(
    algorithm,
    decodeKey(encodedKey),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}
