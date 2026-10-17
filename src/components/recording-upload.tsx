"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cancelRecordingUploadAction, finalizeRecordingUploadAction, prepareRecordingUploadAction } from "@/app/actions/meetings";

const MAX_BYTES = 500 * 1024 * 1024;

type Target = { kind: "s3"; url: string; fields: Record<string, string> } | { kind: "server"; url: string };

/** Sender filen direkte til lageret (S3) eller som stream til serveren (lokalt) med fremdrift. Ingen server action-body. */
function send(target: Target, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error("Forbindelsen blev afbrudt. Prøv igen."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "Uploaden mislykkedes.";
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
      } catch {
        if (xhr.status === 413 || /EntityTooLarge/.test(xhr.responseText)) msg = "Filen er for stor (maks 500 MB).";
      }
      reject(new Error(msg));
    };
    if (target.kind === "s3") {
      const form = new FormData();
      for (const [k, v] of Object.entries(target.fields)) form.append(k, v);
      form.append("file", file);
      xhr.open("POST", target.url);
      xhr.send(form);
    } else {
      xhr.open("PUT", target.url);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(file);
    }
  });
}

export function RecordingUpload({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    setError(null);
    if (!file) return setError("Vælg en lyd- eller videofil.");
    if (file.size > MAX_BYTES) return setError("Filen er for stor (maks 500 MB).");
    setBusy(true);
    setProgress(0);
    let pending: string | null = null;
    try {
      const prep = await prepareRecordingUploadAction(meetingId, file.size);
      if (!prep.ok) throw new Error(prep.error);
      pending = prep.recordingId;
      await send(prep.target, file, setProgress);
      const fin = await finalizeRecordingUploadAction(prep.recordingId);
      pending = null; // finalize rydder selv op ved fejl
      if (!fin.ok) throw new Error(fin.error);
      setDone(true);
      router.refresh();
    } catch (err) {
      if (pending) await cancelRecordingUploadAction(pending).catch(() => {});
      setError(err instanceof Error ? err.message : "Uploaden mislykkedes.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (done) {
    return (
      <p role="status" className="callout mt-3 text-sm" data-testid="upload-done">
        Optagelsen er uploadet og transskriberes nu. Siden opdateres, når resuméet er klar.
      </p>
    );
  }
  return (
    <form onSubmit={upload} className="mt-3 grid gap-3" aria-busy={busy}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="recording-file">Optagelse (lyd eller video)</label>
        <input ref={input} id="recording-file" type="file" name="file" accept="audio/*,video/*" required className="text-sm" disabled={busy} />
        <button className="btn" type="submit" disabled={busy}>{busy ? "Uploader …" : "Upload og transskriber"}</button>
      </div>
      {progress !== null && (
        <div>
          <div className="h-1 bg-grey-bg" role="progressbar" aria-label="Upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-1 bg-navy transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{progress} %</p>
        </div>
      )}
      {error && <p role="alert" className="callout callout-error text-sm" data-testid="upload-error">{error}</p>}
      <p className="text-xs text-muted">MP3, M4A, MP4, MOV, WebM, WAV, Ogg eller FLAC, højst 500 MB. Formatet tjekkes ud fra filens indhold.</p>
    </form>
  );
}
