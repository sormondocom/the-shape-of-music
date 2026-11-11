import React from 'react';

function PageWrapper(props) {
  const { children } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {children}
    </div>
  );
}

export default PageWrapper;
