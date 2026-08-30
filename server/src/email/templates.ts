export type MailTemplateName = "verify_email" | "reset_password";

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderActionMail(input: {
  title: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  expiryMinutes: number;
}) {
  const safeUrl = escapeHtml(input.actionUrl);
  const subject = `[ClassOps] ${input.title}`;
  const text = `${input.intro}\n\n${input.actionLabel}: ${input.actionUrl}\n\nลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน ${input.expiryMinutes} นาที หากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลนี้`;
  const html = `<!doctype html>
<html lang="th">
  <body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#172033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#5363df">CLASSOPS</div>
            <h1 style="font-size:24px;margin:14px 0">${escapeHtml(input.title)}</h1>
            <p style="line-height:1.7">${escapeHtml(input.intro)}</p>
            <p style="margin:28px 0">
              <a href="${safeUrl}" style="display:inline-block;background:#4656d8;color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:700">${escapeHtml(input.actionLabel)}</a>
            </p>
            <p style="font-size:13px;line-height:1.6;color:#687086">ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน ${input.expiryMinutes} นาที หากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาเพิกเฉยต่ออีเมลนี้</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export function renderMailTemplate(template: MailTemplateName, payload: Record<string, unknown>) {
  const actionUrl = String(payload.actionUrl ?? "");
  const expiryMinutes = Number(payload.expiryMinutes ?? 0);
  if (!actionUrl.startsWith("https://") && !actionUrl.startsWith("http://localhost")) {
    throw new Error("Mail action URL is not trusted");
  }
  if (!Number.isInteger(expiryMinutes) || expiryMinutes < 1) {
    throw new Error("Mail expiry is invalid");
  }

  if (template === "verify_email") {
    return renderActionMail({
      title: "ยืนยันอีเมลของคุณ",
      intro: "กรุณายืนยันอีเมลเพื่อเปิดใช้งานบัญชี ClassOps",
      actionLabel: "ยืนยันอีเมล",
      actionUrl,
      expiryMinutes,
    });
  }

  return renderActionMail({
    title: "ตั้งรหัสผ่านใหม่",
    intro: "เราได้รับคำขอให้ตั้งรหัสผ่าน ClassOps ใหม่",
    actionLabel: "ตั้งรหัสผ่านใหม่",
    actionUrl,
    expiryMinutes,
  });
}
