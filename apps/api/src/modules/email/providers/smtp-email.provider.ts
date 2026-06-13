import { Injectable } from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import { env } from '../../../config/env'
import type { EmailProvider, SendEmailOptions } from '../interfaces/email-provider.interface'

/** SMTP provider (SendGrid, Mailgun, etc.). Selected when EMAIL_PROVIDER=smtp. */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })

  async send(opts: SendEmailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    })
  }
}
