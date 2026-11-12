// Renders every sounding cue offline in Chrome and prints its peak and loudest 400ms window
// (approximate K-weighted momentary loudness, both channels summed as BS.1770 does, so the
// figures compare directly with stereo music at -14 LUFS). Run after changing a voice or LEVEL in
// src/feedback/index.ts: node scripts/feedback-levels.mjs
import {chromium} from '@playwright/test';
import {build} from 'vite';

const [output] = await build({
  configFile: false,
  logLevel: 'silent',
  define: {'process.env.NODE_ENV': '"production"'},
  build: {
    lib: {entry: 'src/feedback/index.ts', formats: ['iife'], name: 'FB'},
    minify: false,
    write: false,
  },
});
const bundle = `${output.output[0].code};window.FB=FB;`;
const browser = await chromium.launch({
  executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome',
});
const page = await browser.newPage();
for (const [cue, step] of [
  ['set', 0],
  ['set', 9],
  ['exercise', 0],
  ['start', 0],
  ['finish', 0],
  ['pr', 0],
]) {
  await page.goto('about:blank');
  const {peak, momentary} = await page.evaluate(
    async ({bundle, cue, step}) => {
      const rate = 48000;
      const offline = new OfflineAudioContext(2, rate * 3, rate);
      window.AudioContext = function () {
        return offline;
      };
      navigator.vibrate = () => true;
      (0, eval)(bundle);
      window.FB.cue(cue, step);
      const rendered = await offline.startRendering();
      let peak = 0;
      for (let c = 0; c < rendered.numberOfChannels; c++)
        for (const x of rendered.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
      const weighting = new OfflineAudioContext(2, rendered.length, rate);
      const source = weighting.createBufferSource();
      source.buffer = rendered;
      const shelf = weighting.createBiquadFilter();
      shelf.type = 'highshelf';
      shelf.frequency.value = 1681;
      shelf.gain.value = 4;
      const highpass = weighting.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 38;
      highpass.Q.value = 0.5;
      source.connect(shelf).connect(highpass).connect(weighting.destination);
      source.start();
      const weighted = await weighting.startRendering();
      const channels = Array.from({length: weighted.numberOfChannels}, (_, c) =>
        weighted.getChannelData(c),
      );
      const window400 = Math.floor(rate * 0.4);
      let loudest = 0;
      for (let i = 0; i + window400 < weighted.length; i += 480) {
        let sum = 0;
        for (const channel of channels)
          for (let j = i; j < i + window400; j++) sum += channel[j] * channel[j];
        loudest = Math.max(loudest, sum / window400);
      }
      return {peak: 20 * Math.log10(peak), momentary: -0.691 + 10 * Math.log10(loudest)};
    },
    {bundle, cue, step},
  );
  console.log(
    `${`${cue}${cue === 'set' ? ` #${step + 1}` : ''}`.padEnd(10)} peak ${peak.toFixed(1)} dBFS, momentary ${momentary.toFixed(1)} LUFS`,
  );
}
await browser.close();
