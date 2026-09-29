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

/**
 * Total size of regular files under a directory (not following symlinks).
 *
 * @param {string} dir - Directory.
 *
 * @returns {Promise<number>} Size in bytes.
 */
export async function directorySize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, {withFileTypes: true});
  } catch(e) {
    if(e.code === 'ENOENT') {
      return 0;
    }
    throw e;
  }
  for(const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if(entry.isDirectory()) {
      total += await directorySize(full);
    } else if(entry.isFile()) {
      total += (await fs.lstat(full)).size;
    }
  }
  return total;
}
