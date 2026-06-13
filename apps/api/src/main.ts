import 'reflect-metadata'
import { resolve } from 'node:path'
import { NestFactory, Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { env } from './config/env'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.useGlobalFilters(new HttpExceptionFilter())
  app.useGlobalInterceptors(new TransformInterceptor(new Reflector()))
  app.enableCors({
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  })

  // Serve locally-stored uploads in dev (S3 serves its own URLs).
  if (env.STORAGE_PROVIDER !== 's3') {
    app.useStaticAssets(resolve(env.LOCAL_STORAGE_PATH), { prefix: '/uploads' })
  }

  await app.listen(env.PORT)
  console.log(`API listening on http://localhost:${env.PORT}/api/v1`)
}

void bootstrap()
