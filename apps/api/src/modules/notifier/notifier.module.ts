import { Module } from '@nestjs/common'
import { EmailModule } from '../email/email.module'
import { NotifierService } from './notifier.service'

@Module({
  imports: [EmailModule],
  providers: [NotifierService],
  exports: [NotifierService],
})
export class NotifierModule {}
