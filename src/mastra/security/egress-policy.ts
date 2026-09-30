/**
 * Egress policy for outbound actions.
 *
 * The email step is the only thing this pipeline does that reaches outside the
 * machine and cannot be undone. Policy runs before the human is asked to
 * approve anything: a recipient the operator never sanctioned should be
 * rejected automatically rather than becoming one more dialog to click through.
 */

export type PolicyDecision = {
  allowed: boolean;
  policy: string;
  reason: string;
};

/**
 * Allowlist from LEAD_EMAIL_ALLOWLIST, as comma-separated addresses or
 * `@domain.com` suffixes. Unset means "no allowlist configured", which is
 * reported as a warning rather than silently treated as allow-all.
 */
const allowlist = () =>
  (process.env.LEAD_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export const checkEmailRecipient = (recipient: string): PolicyDecision => {
  const policy = "egress.email.recipient_allowlist";
  const target = recipient.trim().toLowerCase();

  if (!target) {
    return { allowed: false, policy, reason: "No recipient configured." };
  }

  const entries = allowlist();
  if (entries.length === 0) {
    return {
      allowed: true,
      policy,
      reason:
        "No allowlist configured (LEAD_EMAIL_ALLOWLIST unset) - falling through to human approval.",
    };
  }

  const matched = entries.find(
    (entry) => (entry.startsWith("@") ? target.endsWith(entry) : target === entry)
  );

  return matched
    ? { allowed: true, policy, reason: `Recipient matches allowlist entry "${matched}".` }
    : { allowed: false, policy, reason: `Recipient "${target}" is not on the allowlist.` };
};

/** Personal data that leaves the building with the CSV, counted for the approval prompt. */
export const summarisePii = (leads: Array<{ contactInfo: { emails: string[]; phones: string[] } }>) => {
  const emails = leads.reduce((total, lead) => total + lead.contactInfo.emails.length, 0);
  const phones = leads.reduce((total, lead) => total + lead.contactInfo.phones.length, 0);
  return { emails, phones, total: emails + phones };
};
