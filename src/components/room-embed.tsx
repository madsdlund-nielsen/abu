"use client";

import { useState } from "react";

export function RoomEmbed({ url, mock }: { url: string; mock: boolean }) {
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <p className="font-medium text-amber-900">Mødet optages og transskriberes automatisk</p>
        <p className="mt-1 text-sm text-amber-800">
          Optagelsen bruges til at lave en transskription og et resumé, som deltagerne kan læse bagefter. Optagelsen slettes,
          når transskriptionen er færdig. Ved at deltage bekræfter du, at du har læst dette.
        </p>
        <button className="btn mt-4" onClick={() => setJoined(true)} type="button">
          Jeg forstår – deltag i mødet
        </button>
      </div>
    );
  }

  if (mock) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl bg-slate-900 p-6 text-center text-white">
        <p className="text-lg font-semibold">Mock-videorum</p>
        <p className="mt-2 max-w-md text-sm text-slate-300">
          Der er ikke koblet en rigtig videoleverandør på (VIDEO_PROVIDER=mock). Her ville Whereby-rummet blive vist. Upload en
          optagelse nedenfor for at teste transskription og resumé.
        </p>
        <p className="mt-3 break-all text-xs text-slate-400">{url}</p>
      </div>
    );
  }

  const src = url + (url.includes("?") ? "&" : "?") + "embed&displayName=&skipMediaPermissionPrompt";
  return (
    <iframe
      src={src}
      title="Videomøde"
      allow="camera; microphone; fullscreen; speaker; display-capture; autoplay"
      className="aspect-video w-full rounded-xl border border-slate-200"
    />
  );
}
