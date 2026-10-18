"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { removeAdvisorPhotoAction, uploadAdvisorPhotoAction, type PhotoState } from "@/app/actions/advisor-photo";
import { AdvisorAvatar } from "@/components/advisor-avatar";
import { ConfirmDialog } from "@/components/cms/primitives";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Profilbillede: kvadratisk forhåndsvisning (radius 0), «Vælg billede» / «Skift billede» / «Fjern billede», træk-og-slip,
 * ventetilstand og danske fejl. Filen sendes til en server action (højst 5 MB); serveren tjekker formatet ud fra
 * indholdet, fjerner metadata og gemmer et 512×512 WebP. Bruges både på /profile og af admin på /admin/advisors/[id].
 */
export function AdvisorPhotoField({ advisorId, name, version, mode = "self" }: { advisorId: string; name: string; version: string | null; mode?: "self" | "admin" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const [current, setCurrent] = useState(version);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<PhotoState>({});
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const admin = mode === "admin";

  // Serveren er sandheden efter router.refresh(): en ny version fra serveren overtager den lokale
  const [serverVersion, setServerVersion] = useState(version);
  if (version !== serverVersion) {
    setServerVersion(version);
    setCurrent(version);
  }
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function upload(file: File | undefined) {
    if (!file || pending) return;
    if (!ACCEPT.split(",").includes(file.type)) return setState({ error: "Filen er ikke et JPEG-, PNG- eller WebP-billede. Andre formater (fx SVG, GIF og HEIC) kan ikke bruges.", at: Date.now() });
    if (file.size > MAX_BYTES) return setState({ error: "Billedet er for stort. Vælg et billede på højst 5 MB.", at: Date.now() });
    setState({});
    setPreview(URL.createObjectURL(file));
    const fd = new FormData();
    if (admin) fd.set("advisorId", advisorId);
    fd.set("photo", file);
    startTransition(async () => {
      let r: PhotoState;
      try {
        r = await uploadAdvisorPhotoAction(fd);
      } catch {
        r = { error: "Billedet kunne ikke uploades. Tjek forbindelsen, og prøv igen.", at: Date.now() };
      }
      setState(r);
      setPreview(null);
      if (r.ok) {
        setCurrent(r.version ?? null);
        router.refresh();
      }
    });
    if (input.current) input.current.value = "";
  }

  function remove() {
    setConfirming(false);
    const fd = new FormData();
    if (admin) fd.set("advisorId", advisorId);
    startTransition(async () => {
      let r: PhotoState;
      try {
        r = await removeAdvisorPhotoAction(fd);
      } catch {
        r = { error: "Billedet kunne ikke fjernes. Prøv igen.", at: Date.now() };
      }
      setState(r);
      if (r.ok) {
        setCurrent(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-space-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start" data-testid="photo-field" aria-busy={pending}>
      <div
        className={`relative h-40 w-40 border-2 ${dragging ? "border-dashed border-navy" : "border-transparent"}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]); }}
        data-testid="photo-dropzone"
      >
        {preview ? (
          // Forhåndsvisning af den valgte fil, mens serveren behandler den (blob:-URL, kun i denne browser)
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" width={160} height={160} className="h-40 w-40 object-cover opacity-60" />
        ) : (
          <AdvisorAvatar advisorId={advisorId} name={name} photo={current} size="lg" />
        )}
        {pending && (
          <span className="absolute inset-x-0 bottom-0 bg-overlay-navy px-2 py-1 text-center text-xs font-semibold text-white" role="status" data-testid="photo-pending">
            {preview ? "Behandler billedet …" : "Gemmer …"}
          </span>
        )}
      </div>
      <div>
        <p className="label !mb-1">Profilbillede (valgfrit)</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={pending} aria-describedby={helpId} data-testid="photo-choose">
            {current ? "Skift billede" : "Vælg billede"}
          </button>
          {current && (
            <button type="button" className="btn-danger btn-sm" onClick={() => setConfirming(true)} disabled={pending} data-testid="photo-remove">
              Fjern billede
            </button>
          )}
        </div>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => upload(e.target.files?.[0])} data-testid="photo-input" />
        <p id={helpId} className="mt-2 text-xs text-muted">
          JPEG, PNG eller WebP, højst 5 MB og mindst 200 × 200 pixels. Du kan også trække et billede over på feltet. Billedet beskæres til et kvadrat, og
          placering og andre metadata (EXIF) fjernes, før det gemmes. {admin ? "Det vises for kunder, når rådgiveren er aktiv." : "Det vises for kunder, når du er aktiv."}
        </p>
        {state.error && <p role="alert" key={state.at} className="callout callout-error mt-2 text-sm" data-testid="photo-error">{state.error}</p>}
        {state.ok && <p role="status" key={state.at} className="callout mt-2 text-sm" data-testid="photo-ok">{state.ok}</p>}
      </div>
      <ConfirmDialog open={confirming} title="Fjern profilbilledet?" confirmLabel="Fjern billede" onConfirm={remove} onCancel={() => setConfirming(false)}>
        <p>{admin ? `${name} vises igen med initialer.` : "Du vises igen med dine initialer."} Billedet slettes fra lageret.</p>
      </ConfirmDialog>
    </div>
  );
}
