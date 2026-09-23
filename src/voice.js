import { getSettings } from './settings.js';

/**
 * Plays lines out of one voice recording, each line a [start, end] stretch of it in seconds.
 * Web Audio rather than an <audio> element because it starts and stops at exact times -- an
 * element's timeupdate only fires every ~250ms, so a line would clip into the next one.
 * Starting a new line stops the one playing. Honours the Sound Effects toggle.
 */
export function createVoice(url) {
  const ctx = new AudioContext();
  const recording = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => null); // no voice is fine -- everything she says is also shown or optional
  let source = null;
  let wanted = null;

  function stop() {
    wanted = null;
    source?.stop();
    source = null;
  }

  function play([start, end]) {
    stop();
    // Any new sound respects the Sound Effects toggle, read at the moment it plays.
    if (!getSettings().sfx) return;
    const line = (wanted = [start, end]);
    ctx.resume();
    recording.then((buffer) => {
      if (!buffer || wanted !== line) return; // superseded before the file finished loading
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0, start, end - start);
    });
  }

  return { play, stop, close: () => (stop(), ctx.close()) };
}
