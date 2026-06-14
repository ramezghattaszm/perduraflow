import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { JwtStrategy } from '../../common/strategies/jwt.strategy'
import { NotifierModule } from '../notifier/notifier.module'
import { OrgModule } from '../org/org.module'
import { TenantModule } from '../tenant/tenant.module'
import { AuthAdminController } from './auth.admin.controller'
import { AuthController } from './auth.controller'
import { authDbProvider } from './auth.db'
import { AuthRepository } from './auth.repository'
import { AuthService } from './auth.service'
import { ProfileController } from './profile.controller'

/**
 * Auth module (kernel). Owns the `auth` Postgres schema (user, role,
 * approval_tier, otp_code) + its scoped Drizzle instance. Imports TenantModule
 * (tenant resolution) and OrgModule (the `org.read` contract used to validate
 * role scope refs — O4); EventBus is global.
 */
@Module({
  imports: [PassportModule, JwtModule.register({}), NotifierModule, TenantModule, OrgModule],
  controllers: [AuthController, ProfileController, AuthAdminController],
  providers: [authDbProvider, AuthService, AuthRepository, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
