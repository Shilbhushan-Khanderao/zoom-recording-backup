const Joi = require('joi');
const Logger = require('../utils/logger');

/**
 * Middleware to validate request body against a Joi schema
 */
const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { 
      abortEarly: false,
      stripUnknown: true // Remove unknown keys for security
    });

    if (error) {
      Logger.warn('Input validation failed', { 
        path: req.path, 
        errors: error.details.map(x => x.message) 
      });
      
      return res.status(422).json({
        error: 'Validation Error',
        message: 'Invalid request parameters',
        details: error.details.map(x => ({
          field: x.path.join('.'),
          message: x.message
        }))
      });
    }

    // Replace req.body with validated and sanitized value
    req.body = value;
    next();
  };
};

module.exports = {
  validateBody
};
