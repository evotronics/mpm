/**
 * Text helpers.
 */

/**
 * Make text from outside mpm (remote APIs, git config) safe to print by
 * escaping control characters, which could otherwise inject terminal
 * escape sequences.
 *
 * @param {string} value - Text.
 *
 * @returns {string} Text with control characters shown as `\xNN`.
 */
export function printable(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g,
    c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
