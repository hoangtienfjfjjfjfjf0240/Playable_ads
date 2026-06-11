import type { ReactNode } from 'react';
import styles from './theme.module.css';

export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.theme}>
      <div className={styles.folio} aria-hidden="true">
        <span>Playable Studio</span>
        <span>Swiss UI V2</span>
        <span>Live Grid</span>
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>V2</span>
        <span>Routes Preserved</span>
      </div>
      <div className={styles.corner} aria-hidden="true">
        PS
      </div>
      {children}
    </div>
  );
}
