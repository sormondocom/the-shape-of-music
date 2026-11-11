import { useRef, useState, useEffect } from 'react';
import moment from 'moment';
import Tone from 'tone';
import Recorder from 'utils/Recorder';
import { encodeMp3FromChannelBuffers } from 'utils/mp3Encoder';

export const useRecorder = () => {
  const recorder = useRef(null);
  useEffect(() => {
    recorder.current = new Recorder(Tone.Master);
  }, []);
  const [isRecording, setIsRecording] = useState(false);
  const [isArmed, setIsArmed] = useState(false);
  const [downloadUrls, setDownloadUrls] = useState([]);

  const beginRecording = () => {
    setIsArmed(false);
    setIsRecording(true);
    recorder.current.record();
  };

  const stopRecording = (fileName = 'My project') => {
    recorder.current.exportWAV(wavBlob => {
      // read the raw buffer for MP3 encoding before it's wiped by clear()
      recorder.current.getBuffer(channelBuffers => {
        const mp3Blob = encodeMp3FromChannelBuffers(
          channelBuffers,
          recorder.current.context.sampleRate
        );

        const newDownloadUrls = downloadUrls.slice();
        const createdAt = moment();
        newDownloadUrls.push({
          wavBlob,
          mp3Blob,
          fileName: `${fileName}[theshapeofmusic]`,
          createdAt,
        });
        setDownloadUrls(newDownloadUrls);
        recorder.current.stop();
        recorder.current.clear();
      });
    });
    setIsRecording(false);
  };

  return {
    isArmed,
    isRecording,
    beginRecording,
    stopRecording,
    downloadUrls,
    armRecording: () => {
      setIsArmed(!isArmed);
    },
  };
};
