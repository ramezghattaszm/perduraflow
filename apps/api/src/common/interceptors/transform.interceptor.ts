import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { map, type Observable } from 'rxjs'
import { SKIP_TRANSFORM } from '../decorators/skip-transform.decorator'

/**
 * Wraps every successful response in `{ statusCode, data }` (ApiEnvelope). The
 * client's axios layer unwraps `.data`. Handlers marked @SkipTransform() pass
 * through untouched.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skip) return next.handle()

    const { statusCode } = context.switchToHttp().getResponse<{ statusCode: number }>()
    return next.handle().pipe(map((data) => ({ statusCode, data })))
  }
}
