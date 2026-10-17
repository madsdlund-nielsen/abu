import type { SignatureScheme } from "../webhooks/signature";

/**
 * Signaturskema for betalingswebhooks (H-4): HMAC-SHA256 over `<tidsstempel>.<rå body>` med webhook-hemmeligheden,
 * sendt som `Frisbii-Signature: t=<unix-sek.>,v1=<hex>`, og højst 5 minutter gammelt.
 *
 * VIGTIGT: Betalingsudbyderen er ikke valgt endnu (Frisbii eller Alunta). Headernavn, nøgler, hvad der signeres og
 * kodning SKAL rettes til udbyderens dokumentation, når kontoen findes – det er alt sammen samlet i denne konstant.
 * Signerer udbyderen ikke selve body'en (fx kun `timestamp + id` som Reepays gamle skema), må body'en ikke stoles på:
 * hent da begivenheden via udbyderens API ud fra id'et (se docs/OPEN_ITEMS.md).
 */
export const PAYMENT_WEBHOOK_SCHEME: SignatureScheme = {
  header: "frisbii-signature",
  format: { kind: "combined", timestampKey: "t", signatureKey: "v1" },
  payload: (timestamp, rawBody) => `${timestamp}.${rawBody}`,
  encoding: "hex",
  toleranceSeconds: 300,
};
