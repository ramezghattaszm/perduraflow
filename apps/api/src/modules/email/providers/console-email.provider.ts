import { Injectable, Logger } from '@nestjs/common'
import type { EmailProvider, SendEmailOptions } from '../interfaces/email-provider.interface'

/** Dev/default provider — logs the email instead of sending it. */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email')

  async send(opts: SendEmailOptions): Promise<void> {
    this.logger.log(`[email] to=${opts.to} subject="${opts.subject}" :: ${opts.text}`)
  }
}
