/**
 * Single updating progress line for TTYs.
 */
import {width} from './format.js';

const RENDER_INTERVAL_MS = 80;

export class ProgressLine {
  /**
   * @param {object} options - Options.
   * @param {object} options.stream - TTY stream to draw on.
   * @param {string} options.label - Label, usually the command name.
   * @param {number} options.total - Total number of items.
   * @param {object} options.c - Colors.
   */
  constructor({stream, label, total, c}) {
    this.stream = stream;
    this.label = label;
    this.total = total;
    this.c = c;
    this.done = 0;
    this.running = new Map();
    this.visible = false;
    this.timer = null;
    this.lastRender = 0;
  }

  start(index, name) {
    this.running.set(index, name);
    this.schedule();
  }

  finish(index) {
    this.running.delete(index);
    this.done++;
    this.schedule();
  }

  /**
   * Write text above the progress line.
   *
   * @param {object} stream - Stream to write the text to.
   * @param {string} text - Text to write.
   */
  write(stream, text) {
    this.clear();
    stream.write(text);
    this.render();
  }

  clear() {
    if(this.visible) {
      this.stream.write('\r\x1b[2K');
      this.visible = false;
    }
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.clear();
  }

  schedule() {
    const now = Date.now();
    if(now - this.lastRender >= RENDER_INTERVAL_MS) {
      this.render();
    } else if(!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.render();
      }, RENDER_INTERVAL_MS);
      this.timer.unref?.();
    }
  }

  render() {
    if(this.done >= this.total) {
      this.clear();
      return;
    }
    this.lastRender = Date.now();
    const {c} = this;
    const names = [...this.running.values()].join(', ');
    let line = `${c.bold(this.label)} [${this.done}/${this.total}]` +
      (this.running.size > 0 ?
        ` ${this.running.size} running: ${c.dim(names)}` : '');
    const columns = (this.stream.columns || 80) - 1;
    if(width(line) > columns) {
      // re-render without color to truncate safely
      line = `${this.label} [${this.done}/${this.total}] ` +
        `${this.running.size} running: ${names}`;
      line = line.slice(0, columns - 1) + '…';
    }
    this.stream.write('\r\x1b[2K' + line);
    this.visible = true;
  }
}
