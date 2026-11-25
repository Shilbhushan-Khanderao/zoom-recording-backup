/**
 * Logger Utility for Dashboard Server
 * Simple Winston-based logger with structured output
 */

const isProduction = process.env.NODE_ENV === 'production';

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = isProduction ? 'info' : 'debug';

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] > LOG_LEVELS[currentLevel]) {
    return;
  }

  const formattedMessage = formatMessage(level, message, meta);
  
  switch (level) {
    case 'error':
      console.error(formattedMessage);
      break;
    case 'warn':
      console.warn(formattedMessage);
      break;
    case 'info':
      console.log(formattedMessage);
      break;
    case 'debug':
      console.log(formattedMessage);
      break;
    default:
      console.log(formattedMessage);
  }
}

module.exports = {
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta),
};
