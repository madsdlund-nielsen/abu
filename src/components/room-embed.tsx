"use client";

/** Mødelokalet vises direkte (samtykket er givet ved oprettelsen af kontoen – ingen accept-gate). */
export function RoomEmbed({ url, mock, staff = false }: { url: string; mock: boolean; staff?: boolean }) {
  if (mock) {
    // Kun udvikling/test (mock er forbudt i produktion). Udviklerteksten vises kun for rådgivere og admin.
    return (
      <div className="on-dark flex aspect-video w-full flex-col items-center justify-center bg-charcoal p-6 text-center text-white" data-testid="room">
        <p className="text-lg font-light">{staff ? "Mock-videorum" : "Videorummet vises her"}</p>
        <p className="mt-2 max-w-md text-sm text-on-dark-soft">
          {staff
            ? "Der er ikke koblet en rigtig videoleverandør på (VIDEO_PROVIDER=mock). Her ville Whereby-rummet blive vist. Upload en optagelse nedenfor for at teste transskription og resumé."
            : "Dette er et testmiljø uden rigtig videoforbindelse."}
        </p>
        {staff && <p className="mt-3 break-all text-xs text-on-dark-soft">{url}</p>}
      </div>
    );
  }

  const src = url + (url.includes("?") ? "&" : "?") + "embed&displayName=&skipMediaPermissionPrompt";
  return (
    <div>
      <iframe
        src={src}
        title="Videomøde"
        allow="camera; microphone; fullscreen; display-capture; autoplay"
        className="aspect-video w-full border border-grey-bg"
        data-testid="room"
      />
      <p className="mt-2 text-sm">
        <a href={url} target="_blank" rel="noopener noreferrer">Åbn mødet i et nyt vindue</a>
      </p>
    </div>
  );
}
