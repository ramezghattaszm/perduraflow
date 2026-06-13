import { Module } from '@nestjs/common'
import { env } from '../../config/env'
import { EmailService } from './email.service'
import { EMAIL_PROVIDER } from './interfaces/email-provider.interface'
import { ConsoleEmailProvider } from './providers/console-email.provider'
import { SmtpEmailProvider } from './providers/smtp-email.provider'

@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useClass: env.EMAIL_PROVIDER === 'smtp' ? SmtpEmailProvider : ConsoleEmailProvider,
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
