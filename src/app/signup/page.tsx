import { redirect } from "next/navigation";

/** Tilmelding sker nu i onboarding-flowet. */
export default function SignupPage() {
  redirect("/kom-i-gang");
}
