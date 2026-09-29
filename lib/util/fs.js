/**
 * Filesystem helpers.
 */
import fs from 'node:fs/promises';

/**
 * Check whether a path exists (without following a final symlink).
 *
 * @param {string} file - Path.
 *
 * @returns {Promise<boolean>} True if it exists.
 */
export async function pathExists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch(e) {
    if(e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      return false;
    }
    throw e;
  }
}
