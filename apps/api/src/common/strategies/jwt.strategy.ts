import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { env } from '../../config/env'
import type { JwtPayload } from '../types/jwt-payload.types'

/**
 * Passport JWT strategy: extracts the Bearer token, verifies it against
 * JWT_ACCESS_SECRET, and exposes the decoded payload as the request user.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ACCESS_SECRET,
    })
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload
  }
}
