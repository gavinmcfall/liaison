import type { GitHubInstallationToken } from "../types.js";

const GITHUB_API = "https://api.github.com";

/**
 * GitHub App authentication.
 *
 * GitHub Apps authenticate in two steps:
 * 1. Create a JWT signed with the App's private key
 * 2. Exchange the JWT for an installation access token
 *
 * The installation token is scoped to the repos the App is installed on.
 */

/**
 * Create a JWT for GitHub App authentication.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */
export async function createAppJWT(
  appId: string,
  privateKeyPEM: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iat: now - 60, // Issued 60 seconds in the past for clock drift
    exp: now + 600, // Expires in 10 minutes (max allowed)
    iss: appId,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(privateKeyPEM);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Get an installation access token for a specific GitHub App installation.
 */
export async function getInstallationToken(
  appId: string,
  privateKeyPEM: string,
  installationId: number,
): Promise<GitHubInstallationToken> {
  const jwt = await createAppJWT(appId, privateKeyPEM);

  const response = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Liaison-Bot",
      },
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to get installation token: ${response.status} ${error}`,
    );
  }

  return response.json() as Promise<GitHubInstallationToken>;
}

/**
 * Import a PEM-encoded RSA private key for use with Web Crypto.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and whitespace
  const pemBody = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  // Try PKCS#8 first, fall back to PKCS#1
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    // If PKCS#8 fails, wrap PKCS#1 in PKCS#8 envelope
    const pkcs8 = wrapPkcs1InPkcs8(binaryDer);
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
}

/**
 * Wrap a PKCS#1 RSA private key in a PKCS#8 envelope.
 * GitHub App keys are typically in PKCS#1 format.
 */
function wrapPkcs1InPkcs8(pkcs1: Uint8Array): Uint8Array {
  // PKCS#8 header for RSA
  const header = new Uint8Array([
    0x30, 0x82, // SEQUENCE
    0x00, 0x00, // length placeholder (2 bytes)
    0x02, 0x01, 0x00, // INTEGER 0 (version)
    0x30, 0x0d, // SEQUENCE (algorithmIdentifier)
    0x06, 0x09, // OID
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // rsaEncryption
    0x05, 0x00, // NULL
    0x04, 0x82, // OCTET STRING
    0x00, 0x00, // length placeholder (2 bytes)
  ]);

  const totalLength = header.length + pkcs1.length;
  const result = new Uint8Array(totalLength);
  result.set(header);
  result.set(pkcs1, header.length);

  // Fix outer SEQUENCE length (total - 4 bytes for tag + length)
  const outerLength = totalLength - 4;
  result[2] = (outerLength >> 8) & 0xff;
  result[3] = outerLength & 0xff;

  // Fix OCTET STRING length
  const octetLength = pkcs1.length;
  result[header.length - 2] = (octetLength >> 8) & 0xff;
  result[header.length - 1] = octetLength & 0xff;

  return result;
}

/**
 * Base64url encode a string or ArrayBuffer.
 */
function base64UrlEncode(input: string | ArrayBuffer): string {
  let base64: string;
  if (typeof input === "string") {
    base64 = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
