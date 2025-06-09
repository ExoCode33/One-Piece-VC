const config = require('../../config/config');

class Logger {
    static log(message) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
    }

    static error(message, error) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] ERROR: ${message}`, error);
    }

    static debug(message) {
        if (config.debug) {
            const timestamp = new Date().toISOString();
            console.debug(`[${timestamp}] DEBUG: ${message}`);
        }
    }
}

module.exports = Logger;
