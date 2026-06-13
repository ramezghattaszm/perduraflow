/**
 * Pluggable email provider (API-ARCHITECTURE.md §10). EmailService is the only
 * thing other modules inject; the concrete provider is chosen by EMAIL_PROVIDER.
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER')

export interface SendEmailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailProvider {
  send(opts: SendEmailOptions): Promise<void>
}
