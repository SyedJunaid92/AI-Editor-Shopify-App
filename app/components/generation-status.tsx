import { useEffect, useRef, type KeyboardEvent } from "react";
import styles from "../styles/editor.module.css";

export function GenerationStatus({
  generating,
  status,
  preview,
  elapsedLabel,
  onCancel,
}: {
  generating: boolean;
  status: string;
  preview: string;
  elapsedLabel: string;
  onCancel: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!generating) return;
    overlayRef.current?.focus();
    const blockDismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", blockDismiss, true);
    return () => window.removeEventListener("keydown", blockDismiss, true);
  }, [generating]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [preview, generating]);

  if (!generating) return null;

  const thinking = status.startsWith("Thinking");

  const onOverlayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Tab") return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
  };

  return (
    <div
      ref={overlayRef}
      className={styles.generationOverlay}
      role="dialog"
      aria-labelledby="generation-status-label"
      tabIndex={-1}
      onKeyDown={onOverlayKeyDown}
    >
      <div className={styles.generationCard}>
        <div className={styles.liveStatus}>
          <span className={styles.spinner} aria-hidden="true" />
          <span id="generation-status-label" aria-live="polite">
            {status}
          </span>
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
        <div className={styles.generationActions}>
          <p className={styles.generationNote}>Keys will not close this.</p>
          <button type="button" className={styles.generationCancel} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
