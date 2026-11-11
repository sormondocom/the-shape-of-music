import lamejs from 'lamejs';

const { Mp3Encoder } = lamejs;

const MP3_BITRATE_KBPS = 128;
const SAMPLE_BLOCK_SIZE = 1152; // lamejs encodes in fixed-size blocks

const floatTo16BitPCM = floatSamples => {
  const int16Samples = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Samples;
};

/*
  Encodes the same per-channel Float32Array buffers Recorder.getBuffer()
  already produces (pre-WAV-encoding raw PCM) into a single MP3 Blob.
*/
export const encodeMp3FromChannelBuffers = (channelBuffers, sampleRate) => {
  const numChannels = channelBuffers.length >= 2 ? 2 : 1;
  const left = floatTo16BitPCM(channelBuffers[0]);
  const right = numChannels === 2 ? floatTo16BitPCM(channelBuffers[1]) : null;

  const encoder = new Mp3Encoder(numChannels, sampleRate, MP3_BITRATE_KBPS);
  const mp3Chunks = [];

  for (let i = 0; i < left.length; i += SAMPLE_BLOCK_SIZE) {
    const leftChunk = left.subarray(i, i + SAMPLE_BLOCK_SIZE);
    const chunk =
      numChannels === 2
        ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + SAMPLE_BLOCK_SIZE))
        : encoder.encodeBuffer(leftChunk);
    if (chunk.length > 0) {
      mp3Chunks.push(chunk);
    }
  }

  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) {
    mp3Chunks.push(finalChunk);
  }

  return new Blob(mp3Chunks, { type: 'audio/mp3' });
};
