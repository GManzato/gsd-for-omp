'use strict';

/**
 * Small dependency-free helpers shared across extension modules.
 */

const fs = require('node:fs');

function parseCommandLine(input) {
  const tokens = String(input || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return tokens.map((token) => {
    const first = token[0];
    return first === '"' || first === "'" ? token.slice(1, -1) : token;
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Write JSON to `target` through a same-directory temporary file and rename, so
 * readers never observe a partial file. Returns false (and cleans up) on failure.
 * @param {string} target
 * @param {unknown} value
 * @returns {boolean}
 */
function writeJsonAtomically(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(temporary, target);
    return true;
  } catch {
    try { fs.unlinkSync(temporary); } catch { /* nothing to clean up */ }
    return false;
  }
}

module.exports = {
  escapeRegExp,
  parseCommandLine,
  writeJsonAtomically,
};
