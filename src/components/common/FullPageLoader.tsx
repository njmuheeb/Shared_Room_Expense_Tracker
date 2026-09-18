import React from 'react';

interface FullPageLoaderProps {
  message: string;
  /** Fills the viewport; use before the app shell exists. */
  fullScreen?: boolean;
}

/** Neutral loading state so the UI never flashes wrong or empty data. */
export const FullPageLoader: React.FC<FullPageLoaderProps> = ({
  message,
  fullScreen = false,
}) => (
  <div
    className={`full-page-loader ${fullScreen ? 'full-page-loader--screen' : ''}`}
    role="status"
    aria-live="polite"
  >
    <span className="loader-spinner" aria-hidden="true" />
    <p className="room-hint">{message}</p>
  </div>
);
