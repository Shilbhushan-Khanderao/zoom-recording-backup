#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const cliProgress = require('cli-progress');
const Logger = require('./src/logger');
const ConfigManager = require('./src/configManager');
const BackupOrchestrator = require('./src/backupOrchestrator');
const packageJson = require('./package.json');
require('dotenv').config();

const program = new Command();

program
  .name('zoom-backup')
  .description('CLI tool to backup Zoom recordings to Google Drive')
  .version(packageJson.version);

// Command: Backup
// Exit codes: 0 = all files succeeded (or nothing to do), 2 = partial, 1 = failed / invalid input
program
  .command('backup')
  .description('Start a backup operation')
  .option('-t, --topic <string>', 'Filter recordings by topic')
  .option('-d, --date <string>', 'Back up recordings from this date (YYYY-MM-DD) until today')
  .option('-u, --user <string>', 'Override User ID from config')
  .option('--backup-id <string>', 'Link to an existing backup job ID')
  .option('--files <string>', 'Base64 JSON array of specific files to backup')
  .option('--dry-run', 'List what would be backed up without downloading/uploading')
  .option('--source <name>', 'Trigger source recorded in the dashboard (e.g. scheduled)')
  .action(async (options) => {
    let orchestrator;

    // Close the dashboard record for exits that happen outside the orchestrator
    const failEarly = async (message) => {
      Logger.error(message);
      // Console logging is off in production; stderr is what the mail-bot emails back
      console.error(`BACKUP FAILED: ${message}`);
      // A busy lock just means another backup is already doing the work
      if (options.source === 'scheduled' && !/already (in progress|running)/i.test(message)) {
        await require('./services/notificationService').sendAlert(
          'scheduled-backup', '❌ Scheduled Zoom backup failed', [message]);
      }
      if (options.backupId) {
        const DashboardClient = require('./src/dashboardClient');
        const client = orchestrator?.dashboardClient || new DashboardClient();
        await client.completeBackup(options.backupId, 'failed', message);
        client.close();
      }
      process.exit(1);
    };

    try {
      if (options.date) {
        // Accept YYYY-MM-DD or a full ISO timestamp (dashboard sends isoDate)
        if (!/^\d{4}-\d{2}-\d{2}/.test(options.date)) {
          return await failEarly(`Invalid --date "${options.date}", expected YYYY-MM-DD`);
        }
        options.date = options.date.slice(0, 10);
      }

      let recordingIds = null;
      if (options.files) {
        try {
          recordingIds = JSON.parse(Buffer.from(options.files, 'base64').toString('utf-8'));
        } catch (err) {
          return await failEarly(`Failed to parse --files argument: ${err.message}`);
        }
        if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
          return await failEarly('No files provided in --files argument.');
        }
      }

      const configManager = new ConfigManager();
      const config = await configManager.loadConfig();
      if (options.user) config.userId = options.user;
      if (options.date) config.fromDate = options.date;
      config.cliOptions = {
        topic: options.topic,
        date: options.date,
        dryRun: options.dryRun,
        backupId: options.backupId,
        triggerSource: options.source
      };

      orchestrator = new BackupOrchestrator();
      await orchestrator.initialize(config);

      const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true,
        format: ' {bar} | {stage} | {percentage}%'
      }, cliProgress.Presets.shades_grey);
      const currentBar = multibar.create(100, 0, { stage: 'Initializing' });

      const handleProgress = (progress) => {
        if (progress.type === 'error') {
          console.error(`\n[ERROR] ${progress.message}`);
          return;
        }
        if (progress.type === 'info' || progress.type === 'success') {
          const stage = progress.stage || 'processing';
          currentBar.update(Math.round((progress.current || 0) * 100), { stage: stage.toUpperCase() });
        }
      };

      if (options.dryRun) Logger.info('DRY RUN: nothing will be downloaded, uploaded or deleted');

      const result = recordingIds
        ? await orchestrator.downloadSpecificFiles(config, recordingIds, handleProgress)
        : await orchestrator.orchestrateBackup(config, handleProgress);

      multibar.stop();
      Logger.info(`Backup operation completed: ${result.message}`);

      const failed = result.errorCount || 0;
      process.exitCode = failed === 0 ? 0 : (result.successCount > 0 ? 2 : 1);
      if (failed > 0 && options.source === 'scheduled') {
        await require('./services/notificationService').sendAlert(
          'scheduled-backup', '⚠️ Scheduled Zoom backup had failures',
          [result.message, ...(result.errors || []).map((e) => `${e.recording}: ${e.error}`)]);
      }
      orchestrator.dashboardClient.close();
    } catch (error) {
      Logger.error('Critical error in backup CLI:', error);
      const { describeError } = require('./src/errorHandler');
      await failEarly(describeError(error.details?.originalError || error));
    }
  });

// Command: Config Check
program
  .command('config-check')
  .description('Validate configuration and paths')
  .action(async () => {
    const configManager = new ConfigManager();
    try {
        const config = await configManager.loadConfig();
        console.log('--- Configuration Check ---');
        console.log(`User ID: ${config.userId ? '\u2713 OK' : '\u2717 MISSING'}`);
        console.log(`Zoom Client ID: ${config.zoomClientId ? '\u2713 OK' : '\u2717 MISSING'}`);
        console.log(`Zoom Client Secret: ${config.zoomClientSecret ? '\u2713 OK' : '\u2717 MISSING'}`);
        console.log(`Zoom Account ID: ${config.zoomAccountId ? '\u2713 OK' : '\u2717 MISSING'}`);
        console.log(`Google Drive Folder: ${config.googleFolder ? '\u2713 OK' : '\u2717 MISSING'}`);
        console.log(`Google Credentials: ${config.googleCredentialsPath ? '\u2713 OK' : '\u2717 MISSING'}`);
        console.log(`Save Path: ${config.savePath}`);
        
        configManager.validateConfig(config); // throws when invalid
        console.log('\n\u2713 Result: Configuration is VALID.');
        console.log('\nYou can now run: node cli.js backup');
    } catch (e) {
        console.error('\n\u2717 Result: Configuration is INVALID.');
        console.error(e.message);
        console.error('\nRun "node cli.js config-setup" to configure settings.');
        process.exit(1);
    }
  });

// Command: Config Setup
program
  .command('config-setup')
  .description('Interactive configuration setup')
  .action(async () => {
    const readline = require('readline');
    const configManager = new ConfigManager();
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));
    
    try {
      console.log('\n=== Zoom Drive Backup CLI Configuration ===\n');
      
      const currentConfig = await configManager.loadConfig().catch(() => ({}));
      
      console.log('Enter the following details (press Enter to keep current value):\n');
      
      const userId = await question(`Zoom User ID [${currentConfig.userId || 'none'}]: `);
      const zoomClientId = await question(`Zoom Client ID [${currentConfig.zoomClientId || 'none'}]: `);
      const zoomClientSecret = await question(`Zoom Client Secret [${currentConfig.zoomClientSecret ? '***' : 'none'}]: `);
      const zoomAccountId = await question(`Zoom Account ID [${currentConfig.zoomAccountId || 'none'}]: `);
      const googleFolder = await question(`Google Drive Folder ID [${currentConfig.googleFolder || 'none'}]: `);
      const savePath = await question(`Local Save Path [${currentConfig.savePath || './downloads'}]: `);
      const deleteFromZoom = await question(`Delete from Zoom after backup? (yes/no) [${currentConfig.deleteFromZoom ? 'yes' : 'no'}]: `);
      
      const newConfig = {
        userId: userId.trim() || currentConfig.userId,
        savePath: savePath.trim() || currentConfig.savePath || './downloads',
        googleFolder: googleFolder.trim() || currentConfig.googleFolder,
        deleteFromZoom: deleteFromZoom.toLowerCase().trim() === 'yes',
        zoomClientId: zoomClientId.trim() || currentConfig.zoomClientId,
        zoomClientSecret: zoomClientSecret.trim() || currentConfig.zoomClientSecret,
        zoomAccountId: zoomAccountId.trim() || currentConfig.zoomAccountId,
        googleCredentialsPath: currentConfig.googleCredentialsPath || './oauth_credentials.json',
        maxRetries: currentConfig.maxRetries || 3,
        retryDelay: currentConfig.retryDelay || 1000,
        bandwidthLimit: currentConfig.bandwidthLimit || 0
      };
      
      await configManager.saveConfig(newConfig);
      
      console.log('\n\u2713 Configuration saved successfully!');
      console.log('\nRun "node cli.js config-check" to validate your configuration.');
      
      rl.close();
    } catch (error) {
      console.error('\nConfiguration setup failed:', error.message);
      rl.close();
      process.exit(1);
    }
  });

// Command: OAuth Setup
program
  .command('oauth-setup')
  .description('Set up Google Drive OAuth2 authentication')
  .action(async () => {
    const readline = require('readline');
    const ConfigManager = require('./src/configManager');
    const DriveUploader = require('./src/driveUploader');
    const Logger = require('./src/logger');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));
    
    try {
      console.log('\n=== Google Drive OAuth2 Setup ===\n');
      console.log('⚠️  IMPORTANT: Ensure your Google Cloud Project "Publishing status" is set to "In production".');
      console.log('⚠️  If it is set to "Testing", your OAuth token will expire every 7 days and backups will fail!\n');
      
      const configManager = new ConfigManager();
      const config = await configManager.loadConfig();
      
      if (!config.googleCredentialsPath) {
        console.log('❌ Google credentials path not configured.');
        console.log('Please run "node cli.js config-setup" first to configure your credentials path.');
        rl.close();
        process.exit(1);
      }
      
      const credentialsPath = config.googleCredentialsPath;
      console.log(`Using credentials file: ${credentialsPath}\n`);
      
      // Initialize Drive Uploader
      const uploader = new DriveUploader(config);
      
      try {
        // Try to initialize - this will fail if OAuth is needed
        await uploader.initialize(credentialsPath);
        console.log('✅ OAuth2 is already configured and working!');
        rl.close();
        return;
      } catch (error) {
        if (error.message !== 'OAUTH_AUTH_REQUIRED') {
          throw error;
        }
      }
      
      // Get authorization URL
      console.log('🔗 Generating authorization URL...\n');
      const authUrl = await uploader.getAuthUrl();
      
      console.log('Please visit this URL in your browser:');
      console.log('\n' + authUrl + '\n');
      
      console.log('Instructions:');
      console.log('1. Click the link above');
      console.log('2. Sign in with your Google account');
      console.log('3. Grant permission to access Google Drive');
      console.log('4. Copy the authorization code from the browser\n');
      
      const authCode = await question('Enter the authorization code: ');
      
      if (!authCode.trim()) {
        console.log('❌ No authorization code provided.');
        rl.close();
        process.exit(1);
      }
      
      console.log('\n🔄 Exchanging authorization code for tokens...\n');
      
      // Set the auth code
      await uploader.setAuthCode(authCode.trim());
      
      console.log('✅ OAuth2 setup completed successfully!');
      console.log('You can now use the backup functionality.\n');
      
      // Test the connection
      try {
        await uploader.drive.about.get({ fields: 'user(displayName,emailAddress)' });
        console.log('✅ Google Drive connection verified!\n');
      } catch (testError) {
        console.log('⚠️  OAuth2 setup completed, but connection test failed. You may need to try again.\n');
      }
      
      rl.close();
    } catch (error) {
      console.error('\n❌ OAuth2 setup failed:', error.message);
      console.log('\nTroubleshooting tips:');
      console.log('1. Make sure your credentials file exists and is valid');
      console.log('2. Check that the authorization code is correct and not expired');
      console.log('3. Verify your Google Cloud Console project has the Drive API enabled');
      console.log('4. Ensure your OAuth consent screen is configured\n');
      
      rl.close();
      process.exit(1);
    }
  });

program.parse();
