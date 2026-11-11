import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Alert, Button } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { saveFileAs } from 'utils/file';
import styles from './styles.module.css';

const propTypes = {
  downloadUrls: PropTypes.array.isRequired,
};

const DownloadRow = ({ wavBlob, mp3Blob, fileName, createdAt }) => {
  const previewUrl = useMemo(() => URL.createObjectURL(wavBlob), [wavBlob]);

  return (
    <li>
      <h2>{createdAt.format('HH:mm:ss [on] MMM DD').toString()}</h2>
      <audio src={previewUrl} controls />

      <Button
        icon={<DownloadOutlined />}
        onClick={() => saveFileAs(wavBlob, `${fileName}.wav`, 'audio/wav')}
      >
        Download WAV
      </Button>
      <Button
        icon={<DownloadOutlined />}
        onClick={() => saveFileAs(mp3Blob, `${fileName}.mp3`, 'audio/mp3')}
      >
        Download MP3
      </Button>
    </li>
  );
};

/* ================================ Toolbar ================================ */
function Downloads(props) {
  const { downloadUrls } = props;
  return (
    <div className={styles.downloads}>
      <div style={{ paddingBottom: 20 }}>
        {downloadUrls.length === 0 ? (
          <span>
            No recordings yet. Press record <i className="ion-record" /> to
            create some!
          </span>
        ) : (
          <span>
            Download your recordings to your computer as WAV or MP3 files.
            The most recent recording is first.
          </span>
        )}
      </div>
      <Alert
        style={{ marginBottom: 20 }}
        showIcon
        type="warning"
        message="Recordings will be lost when you leave or reload the page."
      />
      <ul>
        {downloadUrls
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(({ wavBlob, mp3Blob, fileName, createdAt }) => (
            <DownloadRow
              key={createdAt.valueOf()}
              wavBlob={wavBlob}
              mp3Blob={mp3Blob}
              fileName={fileName}
              createdAt={createdAt}
            />
          ))}
      </ul>
    </div>
  );
}

Downloads.propTypes = propTypes;

export default Downloads;
