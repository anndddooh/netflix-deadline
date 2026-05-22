// メール送信の抽象。本番は Resend、ローカルは ConsoleSender（標準出力）。

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** Resend API でメール送信する */
export class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }
}

/** API キー未設定時のフォールバック。送信せず本文をログに出す。 */
export class ConsoleSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    console.log('========== EMAIL (stub) ==========');
    console.log(`To: ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log('--- text ---');
    console.log(msg.text);
    console.log('==================================');
  }
}

/** env から適切な EmailSender を選ぶ */
export function senderFromEnv(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): EmailSender {
  if (env.RESEND_API_KEY) {
    return new ResendSender(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? 'onboarding@resend.dev'
    );
  }
  return new ConsoleSender();
}
