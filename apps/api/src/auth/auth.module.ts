import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { segredoObrigatorio } from '../seguranca/seguranca';

@Module({
  imports: [
    PassportModule,
    // registerAsync: lê o .env depois que o ConfigModule carregou
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: segredoObrigatorio('JWT_SECRET', 32),
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
