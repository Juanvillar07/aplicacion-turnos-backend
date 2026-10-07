import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicUser } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ChangeEmailDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailCodeDto,
} from './dto/account.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Límite estricto para rutas sensibles a fuerza bruta o spam de correos */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(STRICT)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Usuario actual (valida el token). */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  // ─── Recuperar contraseña ───

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return {
      message:
        'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return {
      message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.',
    };
  }

  // ─── Verificación de correo ───

  /** Código de 6 dígitos enviado al correo → devuelve el usuario verificado. */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyEmail(
    @CurrentUser() user: PublicUser,
    @Body() dto: VerifyEmailCodeDto,
  ) {
    return this.authService.verifyEmail(user.id, dto.code);
  }

  /** ¿Ya hay un código vigente? No envía nada (no cuenta para el límite de reenvíos). */
  @Get('verification-status')
  @UseGuards(JwtAuthGuard)
  verificationStatus(@CurrentUser() user: PublicUser) {
    return this.authService.verificationStatus(user);
  }

  /** Código nuevo (uno por minuto). */
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@CurrentUser() user: PublicUser) {
    const { resendAvailableAt } = await this.authService.resendVerification(
      user.id,
    );
    return {
      message: `Te enviamos un código nuevo a ${user.email}.`,
      resendAvailableAt,
    };
  }

  /** Corrige el correo de una cuenta aún sin verificar y sin negocios. */
  @Patch('email')
  @UseGuards(JwtAuthGuard)
  @Throttle(STRICT)
  changeEmail(@CurrentUser() user: PublicUser, @Body() dto: ChangeEmailDto) {
    return this.authService.changeEmail(user.id, dto.email);
  }

  // ─── Cuenta ───

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @Throttle(STRICT)
  async changePassword(
    @CurrentUser() user: PublicUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Contraseña actualizada' };
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  updateProfile(
    @CurrentUser() user: PublicUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto.name);
  }
}
