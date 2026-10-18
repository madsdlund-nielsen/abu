import QRCode from "qrcode";

/**
 * QR-kode som inline SVG, beregnet på serveren med `qrcode` (låst version). Ingen eksterne QR-tjenester og intet
 * `dangerouslySetInnerHTML`: modulerne tegnes som én <path>, så CSP'en er uændret. Hvid baggrund og 4 modulers stille
 * zone (påkrævet for scanning); mørke moduler i charcoal (høj kontrast).
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  const quiet = 4;
  let d = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return { size: size + quiet * 2, d };
}

export function QrCode({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const { size, d } = qrPath(text);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className={`block h-auto w-full max-w-[15rem] bg-white ${className}`}
      shapeRendering="crispEdges"
      data-testid="mfa-qr"
    >
      <rect width={size} height={size} className="fill-white" />
      <path d={d} className="fill-charcoal" />
    </svg>
  );
}
