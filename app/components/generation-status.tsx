import { useEffect, useRef } from "react";
import styles from "../styles/editor.module.css";

export function GenerationStatus({
  generating,
  status,
  preview,
  elapsedLabel,
}: {
  generating: boolean;
  status: string;
  preview: string;
  elapsedLabel: string;
}) {
  const transcriptRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [preview, generating]);

  if (!generating) return null;

  const thinking = status.startsWith("Thinking");

  return (
    <div className={styles.liveBox}>
      <div className={styles.liveStatus}>
        <span className={styles.spinner} aria-hidden="true" />
        <span aria-live="polite">{status}</span>
        <span className={styles.liveTime}>{elapsedLabel}</span>
      </div>
      {preview ? (
        <pre ref={transcriptRef} className={styles.liveText}>
          {thinking ? <span className={styles.liveLabel}>Thinking{"\n"}</span> : null}
          {preview}
          <span className={styles.caret} aria-hidden="true" />
        </pre>
      ) : (
        <p className={styles.liveWait}>
          Waiting for the first words. Longer requests stay connected and keep updating here.
        </p>
      )}
    </div>
  );
}
