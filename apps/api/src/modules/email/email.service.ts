import { Inject, Injectable } from '@nestjs/common'
import {
  EMAIL_PROVIDER,
  type EmailProvider,
  type SendEmailOptions,
} from './interfaces/email-provider.interface'

/**
 * Thin facade over the pluggable email provider (§10) — the only email export;
 * the concrete provider (console/SES/…) is selected by env and injected.
 */
@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  /** Delivers an email via the configured provider. */
  send(opts: SendEmailOptions): Promise<void> {
    return this.provider.send(opts)
  }
}
