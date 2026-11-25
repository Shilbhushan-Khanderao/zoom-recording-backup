require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TokenManager = require('../utils/tokenManager');
const appPaths = require('../utils/appPaths');

/**
 * Migration script to encrypt existing plaintext tokens.
 * Run this after adding APP_SECRET to your .env file.
 */

async function main() {
  if (!process.env.APP_SECRET) {
    console.error('❌ APP_SECRET is not set in .env. Cannot encrypt tokens.');
    process.exit(1);
  }

  const tokenPaths = [
    appPaths.getTokenPath(),
    appPaths.getBackupTokenPath(),
    appPaths.getZoomTokenPath()
  ];

  let migrated = 0;

  for (const tokenPath of tokenPaths) {
    if (!fs.existsSync(tokenPath)) {
      console.log(`ℹ️ Token file not found, skipping: ${tokenPath}`);
      continue;
    }

    try {
      const rawData = fs.readFileSync(tokenPath, 'utf8');
      
      // Check if already encrypted
      if (rawData.includes(':') && rawData.split(':').length === 3 && !rawData.includes('{')) {
        console.log(`✅ Already encrypted: ${tokenPath}`);
        continue;
      }

      // Try to parse as JSON to verify it's a valid plaintext token
      let tokenData;
      try {
        tokenData = JSON.parse(rawData);
      } catch (err) {
        console.error(`❌ Token is not valid JSON, skipping: ${tokenPath}`);
        continue;
      }

      // Re-write using TokenManager which will encrypt it
      TokenManager.writeTokenSync(tokenPath, tokenData);
      console.log(`🔐 Successfully encrypted: ${tokenPath}`);
      migrated++;
    } catch (error) {
      console.error(`❌ Failed to encrypt ${tokenPath}: ${error.message}`);
    }
  }

  console.log(`\n🎉 Migration complete. Encrypted ${migrated} token file(s).`);
}

main();
