import { createTool } from "@mastra/core/tools";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { z } from "zod";
import { emailResultSchema, summarySchema } from "../workflows/schemas";

export type EmailSummary = z.infer<typeof summarySchema>;
export type EmailResult = z.infer<typeof emailResultSchema>;

/** Not an error: the CSV on disk is the deliverable, mail is a convenience. */
const notSent = (message: string): EmailResult => ({ success: false, message, emailsSent: 0 });

const htmlBody = (summary: EmailSummary, searchQuery: string) => `
  <div style="font-family:system-ui,Segoe UI,sans-serif;color:#0f172a">
    <h2 style="margin-bottom:4px">Qualified lead report</h2>
    <p style="color:#475569;margin-top:0">Search: <strong>${searchQuery}</strong></p>
    <table cellpadding="8" style="border-collapse:collapse;margin-top:16px">
      <tr><td style="border:1px solid #e2e8f0">Total leads</td><td style="border:1px solid #e2e8f0"><strong>${summary.totalFound}</strong></td></tr>
      <tr><td style="border:1px solid #e2e8f0">Hot</td><td style="border:1px solid #e2e8f0">${summary.hotLeads}</td></tr>
      <tr><td style="border:1px solid #e2e8f0">Warm</td><td style="border:1px solid #e2e8f0">${summary.warmLeads}</td></tr>
      <tr><td style="border:1px solid #e2e8f0">Cold</td><td style="border:1px solid #e2e8f0">${summary.coldLeads}</td></tr>
    </table>
    <p style="color:#475569;margin-top:16px">The full breakdown is attached as CSV.</p>
  </div>
`;

/**
 * Mail the CSV report. SMTP is optional in this demo: when it is not configured
 * we report that cleanly instead of failing the pipeline, since the CSV on disk
 * is still the primary deliverable.
 */
export const sendLeadReport = async (
  filepath: string,
  summary: EmailSummary,
  searchQuery: string
): Promise<EmailResult> => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_NAME } = process.env;
  const recipient = process.env.LEAD_REPORT_EMAIL || SMTP_USER;

  // Escape hatch for demoing or testing the pipeline without sending real mail.
  if (process.env.DISABLE_EMAIL === "1") {
    return notSent(
      "Email disabled (DISABLE_EMAIL=1) - the CSV export is still available on disk."
    );
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !recipient) {
    return notSent(
      "SMTP is not configured - skipped email. The CSV export is still available on disk."
    );
  }

  const port = Number(SMTP_PORT || 587);

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });

    await transporter.sendMail({
      from: `"${SMTP_FROM_NAME || "Marketing Agency"}" <${SMTP_USER}>`,
      to: recipient,
      subject: `Lead report - ${summary.totalFound} leads (${summary.hotLeads} hot)`,
      html: htmlBody(summary, searchQuery),
      attachments: filepath
        ? [{ filename: path.basename(filepath), content: await readFile(filepath) }]
        : [],
    });

    return { success: true, message: `Report emailed to ${recipient}`, emailsSent: 1 };
  } catch (error) {
    return notSent(
      `Email failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const emailTool = createTool({
  id: "email-report",
  description: "Email the exported lead CSV with a summary of hot/warm/cold counts.",
  inputSchema: z.object({
    filepath: z.string(),
    searchQuery: z.string().default(""),
    summary: summarySchema,
  }),
  outputSchema: emailResultSchema,
  execute: async ({ context }) =>
    sendLeadReport(context.filepath, context.summary, context.searchQuery),
});
