import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function writeTestMedia(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['valid-video.mp4', 'valid-final.mp4']) {
    fs.copyFileSync(path.join(fixtures, name), path.join(directory, name));
  }

  const sampleRate = 8000;
  const sampleCount = 2000;
  const data = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 12000), index * 2);
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  fs.writeFileSync(path.join(directory, 'valid-audio.wav'), wav);
  fs.writeFileSync(path.join(directory, 'fake-video.mp4'), 'this is not an MP4');
  fs.writeFileSync(path.join(directory, 'fake-audio.wav'), 'not a WAV');
  const relative = (name) => path.relative(path.dirname(directory), path.join(directory, name)).replace(/\\/g, '/');
  return {
    video: relative('valid-video.mp4'),
    finalVideo: relative('valid-final.mp4'),
    audio: relative('valid-audio.wav'),
    fakeVideo: relative('fake-video.mp4'),
    fakeAudio: relative('fake-audio.wav'),
  };
}
