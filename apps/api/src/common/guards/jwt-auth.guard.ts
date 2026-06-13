import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/** Passport JWT guard — authenticates a request from its Bearer access token. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
