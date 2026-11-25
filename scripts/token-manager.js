#!/usr/bin/env node

/**
 * Token Manager CLI
 * Manual tool for managing OAuth tokens
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); // APP_SECRET decrypts tokens
const googleAuthService = require('../services/googleAuthService');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const service = googleAuthService;
  
  // Commands that don't need initialization
  if (command === 'backup') {
    await service.backupToken();
    console.log('✅ Token backup created');
    return;
  }
  
  if (command === 'restore') {
    const restored = await service.restoreFromBackup();
    if (restored) {
      console.log('✅ Token restored from backup');
    } else {
      console.log('❌ Failed to restore token from backup');
    }
    return;
  }
  
  if (command === 'help' || !command) {
    showHelp();
    return;
  }
  
  // Initialize service for other commands
  const initialized = await service.initialize();
  if (!initialized && command !== 'status') {
    console.error('❌ Failed to initialize Token Refresh Service');
    console.error('Make sure oauth_credentials.json and token.json exist');
    process.exit(1);
  }

  switch (command) {
    case 'status':
      await showStatus(service);
      break;
      
    case 'refresh':
      await forceRefresh(service);
      break;
      
    case 'check':
      await checkAndRefresh(service);
      break;
      
    default:
      showHelp();
      break;
  }
}

async function showStatus(service) {
  const status = await service.getTokenStatus();
  
  console.log('\n📊 Token Status');
  console.log('═══════════════════════════════════════');
  console.log(`Exists:        ${status.exists ? '✅ Yes' : '❌ No'}`);
  
  if (status.exists) {
    console.log(`Valid:         ${status.valid ? '✅ Yes' : '❌ No'}`);
    console.log(`Expired:       ${status.expired ? '❌ Yes' : '✅ No'}`);
    console.log(`Needs Refresh: ${status.needsRefresh ? '⚠️  Yes' : '✅ No'}`);
    
    if (status.expiresIn !== undefined) {
      if (status.expiresIn > 60) {
        console.log(`Expires In:    ${Math.floor(status.expiresIn / 60)} hours ${status.expiresIn % 60} minutes`);
      } else if (status.expiresIn > 0) {
        console.log(`Expires In:    ${status.expiresIn} minutes`);
      } else {
        console.log(`Expires In:    Expired ${Math.abs(status.expiresIn)} minutes ago`);
      }
    }
    
    if (status.expiryDate) {
      console.log(`Expiry Date:   ${status.expiryDate}`);
    }
    
    console.log(`\nMessage:       ${status.message}`);
  }
  console.log('═══════════════════════════════════════\n');
}

async function forceRefresh(service) {
  console.log('🔄 Force refreshing token...');
  const success = await service.forceRefresh();
  
  if (success) {
    console.log('✅ Token refreshed successfully');
    await showStatus(service);
  } else {
    console.log('❌ Token refresh failed');
    process.exit(1);
  }
}

async function checkAndRefresh(service) {
  console.log('🔍 Checking token and refreshing if needed...');
  const refreshed = await service.checkAndRefreshToken();
  
  if (refreshed) {
    console.log('✅ Token was refreshed');
  } else {
    console.log('ℹ️  Token is still valid, no refresh needed');
  }
  
  await showStatus(service);
}

function showHelp() {
  console.log(`
📝 Token Manager - OAuth Token Management Tool

Usage:
  node scripts/token-manager.js <command>

Commands:
  status      Show current token status and expiry information
  refresh     Force immediate token refresh
  check       Check if token needs refresh and refresh if needed
  backup      Create backup of current token
  restore     Restore token from backup
  help        Show this help message

Examples:
  node scripts/token-manager.js status
  node scripts/token-manager.js refresh
  node scripts/token-manager.js check

The Token Refresh Service runs automatically in the background when
mail-bot is running, checking and refreshing tokens every 30 minutes.
This tool is for manual management when needed.
  `);
}

// Run
main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
