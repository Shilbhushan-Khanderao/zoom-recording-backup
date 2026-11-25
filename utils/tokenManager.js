const fs = require('fs');
const fsAsync = require('fs').promises;
const crypto = require('crypto');
const Logger = require('../src/logger');

const ALGORITHM = 'aes-256-gcm';

/**
 * Derives a 32-byte key from the APP_SECRET using SHA-256.
 */
function getKey() {
  const secret = process.env.APP_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32);
}

/**
 * Encrypts a string if APP_SECRET is available.
 * Returns the plain string if APP_SECRET is not available.
 * Format: iv:authTag:encryptedData (base64 encoded)
 */
function encrypt(text) {
  const keyStr = getKey();
  if (!keyStr) return text;

  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(keyStr), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return `${iv.toString('base64')}:${authTag}:${encrypted}`;
  } catch (error) {
    Logger.error('Encryption failed', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypts a string if APP_SECRET is available and the string looks encrypted.
 */
function decrypt(text) {
  if (!text) return text;
  
  // Check if it's an encrypted format (iv:authTag:encryptedData); JSON with
  // exactly two colons would otherwise be mistaken for ciphertext
  const parts = text.split(':');
  if (parts.length !== 3 || text.trimStart().startsWith('{')) {
    // Looks like plaintext JSON
    return text;
  }

  const keyStr = getKey();
  if (!keyStr) {
    throw new Error('APP_SECRET is required to decrypt this token.');
  }

  try {
    const [iv, authTag, encryptedText] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(keyStr),
      Buffer.from(iv, 'base64')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    Logger.error('Decryption failed', error);
    throw new Error('Decryption failed. Invalid APP_SECRET or corrupted data.');
  }
}

/**
 * Reads and parses a token file asynchronously
 */
async function readTokenAsync(filePath) {
  try {
    const rawData = await fsAsync.readFile(filePath, 'utf8');
    const decryptedData = decrypt(rawData);
    return JSON.parse(decryptedData);
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    Logger.error(`Failed to read token from ${filePath}: ${error.message}`);
    throw error;
  }
}

/**
 * Serializes and writes a token file synchronously
 */
// Token files are written by several processes (mail-bot, dashboard, CLI runs):
// write a unique temp file then rename, so readers never see a half-written token
const tempPathFor = (filePath) =>
  `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;

function writeTokenSync(filePath, data, options = { mode: 0o600 }) {
  const encrypted = encrypt(JSON.stringify(data, null, 2));
  const tmp = tempPathFor(filePath);
  try {
    fs.writeFileSync(tmp, encrypted, options);
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

/**
 * Serializes and writes a token file asynchronously
 */
async function writeTokenAsync(filePath, data, options = { mode: 0o600 }) {
  const encrypted = encrypt(JSON.stringify(data, null, 2));
  const tmp = tempPathFor(filePath);
  try {
    await fsAsync.writeFile(tmp, encrypted, options);
    await fsAsync.rename(tmp, filePath);
  } catch (error) {
    await fsAsync.unlink(tmp).catch(() => {});
    throw error;
  }
}

module.exports = {
  encrypt,
  decrypt,
  readTokenAsync,
  writeTokenSync,
  writeTokenAsync
};
