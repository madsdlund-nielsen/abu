import { getEnv } from "./env";
import { sendEmailSafe } from "./email";
import { formatDateTime } from "./time";

const appUrl = () => getEnv().APP_URL.replace(/\/$/, "");

export function inviteUrl(token: string) {
  return `${appUrl()}/set-password?token=${encodeURIComponent(token)}`;
}

export function resetUrl(token: string) {
  return `${appUrl()}/set-password?token=${encodeURIComponent(token)}&reset=1`;
}

export async function sendInviteEmail(to: string, name: string, token: string) {
  const url = inviteUrl(token);
  return sendEmailSafe({
    to,
    subject: "Du er inviteret til Advisory Board Unlimited",
    text: `Hej ${name}\n\nDu er oprettet som rådgiver hos Advisory Board Unlimited. Vælg en adgangskode via linket (gyldigt i 7 dage):\n\n${url}\n\nVenlig hilsen\nAdvisory Board Unlimited`,
  });
}

export async function sendResetEmail(to: string, name: string, token: string) {
  const url = resetUrl(token);
  return sendEmailSafe({
    to,
    subject: "Nulstil din adgangskode",
    text: `Hej ${name}\n\nBrug linket herunder til at vælge en ny adgangskode (gyldigt i 2 timer). Hvis du ikke har bedt om det, kan du ignorere mailen.\n\n${url}\n\nVenlig hilsen\nAdvisory Board Unlimited`,
  });
}

export async function sendMeetingBookedEmail(to: string, name: string, meetingId: string, startsAt: Date) {
  return sendEmailSafe({
    to,
    subject: `Møde booket: ${formatDateTime(startsAt)}`,
    text: `Hej ${name}\n\nDer er booket et møde ${formatDateTime(startsAt)}.\nMødet optages og transskriberes automatisk.\n\nSe mødet: ${appUrl()}/meetings/${meetingId}\n\nVenlig hilsen\nAdvisory Board Unlimited`,
  });
}

export async function sendMeetingCancelledEmail(to: string, name: string, startsAt: Date) {
  return sendEmailSafe({
    to,
    subject: `Møde aflyst: ${formatDateTime(startsAt)}`,
    text: `Hej ${name}\n\nMødet ${formatDateTime(startsAt)} er aflyst.\n\nVenlig hilsen\nAdvisory Board Unlimited`,
  });
}
