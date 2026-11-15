import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import * as tls from 'tls';

export interface SentEmail {
  to: string;
  subject: string;
  resetUrl: string;
  sentAt: Date;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private sentEmails: SentEmail[] = [];

  async sendPasswordResetEmail(toEmail: string, resetUrl: string): Promise<boolean> {
    const email = toEmail.trim().toLowerCase();
    const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
    const isTest = process.env.NODE_ENV === 'test' || provider === 'test';
    const isDev = process.env.NODE_ENV !== 'production' && !isTest;

    const emailRecord: SentEmail = {
      to: email,
      subject: 'Reset your CallFlow password',
      resetUrl,
      sentAt: new Date(),
    };

    if (isTest) {
      this.sentEmails.push(emailRecord);
      return true;
    }

    // SMTP configuration check
    const smtpHost = process.env.SMTP_HOST;
    if (provider === 'smtp' || smtpHost) {
      if (!smtpHost) {
        this.logger.error(
          `[EmailService] Email delivery failure for recipient ${email}: EMAIL_PROVIDER is set to 'smtp' but SMTP_HOST is not configured.`,
        );
        throw new Error('SMTP configuration incomplete: SMTP_HOST is required');
      }

      try {
        // When SMTP is configured, attempt real delivery
        const result = await this.sendViaSmtp(email, resetUrl);
        this.logger.log(`[EmailService] Email accepted by configured transport for recipient ${email}.`);
        return result;
      } catch (err: any) {
        this.logger.error(`[EmailService] Email delivery failure for recipient ${email}: ${err?.message || err}`);
        throw new Error(`Email delivery failed: ${err?.message || 'SMTP delivery failure'}`);
      }
    }

    if (isDev) {
      // Safe development mode: store in memory without leaking raw secret tokens to production logs
      this.sentEmails.push(emailRecord);
      this.logger.log(
        `[EmailService] Reset email captured by the development mailer for recipient ${email}. Safe local inspection available via GET /auth/dev/mailbox or GET /auth/dev/last-reset-link.`,
      );
      return true;
    }

    // In production without configured email provider: fail fast and safely
    this.logger.error(`[EmailService] Email delivery failure for recipient ${email}: Email provider not configured in production environment`);
    throw new Error('Email service is not configured');
  }

  private async sendViaSmtp(to: string, resetUrl: string): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
    const emailFrom = process.env.EMAIL_FROM || 'no-reply@callflow.io';

    if (!smtpHost) {
      throw new Error('SMTP_HOST is required for SMTP email provider');
    }

    return new Promise<boolean>((resolve, reject) => {
      const socket = smtpSecure
        ? tls.connect({
            host: smtpHost,
            port: smtpPort,
            rejectUnauthorized: process.env.NODE_ENV === 'production',
          })
        : net.connect({ host: smtpHost, port: smtpPort });

      let step = 0;
      let buffer = '';

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`SMTP connection timed out to ${smtpHost}:${smtpPort}`));
      }, 10000);

      const send = (data: string) => {
        socket.write(data + '\r\n');
      };

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;
          const code = parseInt(line.substring(0, 3), 10);

          if (code >= 400) {
            clearTimeout(timeout);
            socket.destroy();
            return reject(new Error(`SMTP error ${code}: ${line.substring(4)}`));
          }

          // Greeting 220
          if (step === 0 && code === 220) {
            step = 1;
            send(`EHLO localhost`);
          }
          // After EHLO 250
          else if (step === 1 && line.startsWith('250 ') && code === 250) {
            if (smtpUser && smtpPass) {
              step = 2;
              send('AUTH LOGIN');
            } else {
              step = 4;
              send(`MAIL FROM:<${emailFrom}>`);
            }
          }
          // After AUTH LOGIN 334 (Username challenge)
          else if (step === 2 && code === 334) {
            step = 3;
            send(Buffer.from(smtpUser || '').toString('base64'));
          }
          // After Username 334 (Password challenge)
          else if (step === 3 && code === 334) {
            step = 4;
            send(Buffer.from(smtpPass || '').toString('base64'));
          }
          // After Auth success 235
          else if (step === 4 && code === 235) {
            step = 5;
            send(`MAIL FROM:<${emailFrom}>`);
          }
          // After MAIL FROM 250
          else if ((step === 4 || step === 5) && code === 250) {
            step = 6;
            send(`RCPT TO:<${to}>`);
          }
          // After RCPT TO 250
          else if (step === 6 && code === 250) {
            step = 7;
            send('DATA');
          }
          // After DATA 354
          else if (step === 7 && code === 354) {
            step = 8;
            const message = [
              `From: ${emailFrom}`,
              `To: ${to}`,
              `Subject: Reset your CallFlow password`,
              `Content-Type: text/plain; charset=utf-8`,
              '',
              `Hello,`,
              '',
              `We received a request to reset your password for CallFlow.`,
              `Please click the link below to set a new password:`,
              `${resetUrl}`,
              '',
              `This link is valid for 60 minutes and can only be used once.`,
              `If you did not request a password reset, you can safely ignore this email.`,
              '.',
            ].join('\r\n');
            send(message);
          }
          // After message accepted 250
          else if (step === 8 && code === 250) {
            step = 9;
            send('QUIT');
            clearTimeout(timeout);
            socket.end();
            return resolve(true);
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // Testing and development mailbox inspection methods
  getSentEmails(): SentEmail[] {
    return [...this.sentEmails];
  }

  getLastSentEmail(email?: string): SentEmail | undefined {
    if (email) {
      const normalized = email.trim().toLowerCase();
      const filtered = this.sentEmails.filter((e) => e.to.toLowerCase() === normalized);
      return filtered[filtered.length - 1];
    }
    return this.sentEmails[this.sentEmails.length - 1];
  }

  clearSentEmails(): void {
    this.sentEmails = [];
  }
}
