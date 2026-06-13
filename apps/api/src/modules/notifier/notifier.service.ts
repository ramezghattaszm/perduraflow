import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import type { OtpPurpose } from '@perduraflow/contracts'
import { EVENTS, type UserVerifiedPayload } from '../../events'
import { EmailService } from '../email/email.service'

/**
 * Outbound transactional messaging — orchestrates what to send and when, using
 * the pluggable EmailService to actually deliver. Two patterns shown:
 *  - direct call (sendOtp, invoked synchronously by auth), and
 *  - event-driven (welcome email on USER_VERIFIED), decoupled via EventEmitter2.
 * (Distinct from the in-app `notifications` feed module.)
 */
@Injectable()
export class NotifierService {
  constructor(private readonly email: EmailService) {}

  /** Sends an OTP code email (registration or password-reset copy by `type`). */
  async sendOtp(target: string, code: string, type: OtpPurpose): Promise<void> {
    const subject = type === 'registration' ? 'Verify your email' : 'Reset your password'
    await this.email.send({
      to: target,
      subject,
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    })
  }

  /** Event listener: sends the welcome email once a user verifies their account. */
  @OnEvent(EVENTS.USER_VERIFIED)
  async onUserVerified(payload: UserVerifiedPayload): Promise<void> {
    await this.email.send({
      to: payload.email,
      subject: 'Welcome to PerduraFlow',
      text: `Hi ${payload.name}, welcome to PerduraFlow!`,
    })
  }
}
