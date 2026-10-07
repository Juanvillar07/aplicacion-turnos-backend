import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserTokenType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { resetPasswordTemplate } from '../mail/templates/account.templates';
import { PublicUser, toPublicUser } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailVerificationService } from './email-verification.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UserTokensService } from './user-tokens.service';

const SALT_ROUNDS = 10;

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly appUrl: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly tokens: UserTokensService,
    private readonly mail: MailService,
    private readonly emailVerification: EmailVerificationService,
    config: ConfigService,
  ) {
    this.appUrl = config.get('FRONTEND_URL', 'http://localhost:5173');
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException(
        'Este correo ya tiene una cuenta. Inicia sesión para continuar con tu registro.',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      password: hashedPassword,
    });

    // En segundo plano: el registro no espera al correo con el código
    this.emailVerification
      .send(user, { force: true })
      .catch((e: Error) =>
        this.logger.error(`Correo de verificación fallido: ${e.message}`),
      );
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(dto.email);
    // Mensaje genérico para no revelar si el email existe.
    const valid = user && (await bcrypt.compare(dto.password, user.password));
    if (!user || !valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return this.buildAuthResponse(toPublicUser(user));
  }

  // ─── Verificación de correo ──────────────────────────────

  async resendVerification(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Tu correo ya está verificado');
    }
    return this.emailVerification.send(user);
  }

  verifyEmail(userId: string, code: string): Promise<PublicUser> {
    return this.emailVerification.verify(userId, code);
  }

  verificationStatus(user: PublicUser) {
    return this.emailVerification.status(user);
  }

  /**
   * Corrige el correo mientras la cuenta está a medio crear: sin verificar y
   * sin negocios. Envía un código nuevo al correo nuevo. Devuelve una sesión
   * nueva porque el JWT lleva el email.
   */
  async changeEmail(userId: string, email: string): Promise<AuthResponse> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (
      user.emailVerifiedAt ||
      (await this.usersService.hasMemberships(userId))
    ) {
      throw new ForbiddenException(
        'Tu correo ya está confirmado: no se puede cambiar desde aquí.',
      );
    }
    if (email === user.email) {
      throw new BadRequestException('Ese ya es tu correo');
    }
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('El email ya está registrado');
    }
    const updated = await this.usersService.updateEmail(userId, email);
    await this.emailVerification.send(updated, { force: true });
    return this.buildAuthResponse(updated);
  }

  // ─── Recuperar contraseña ────────────────────────────────

  /**
   * Siempre responde igual, exista o no la cuenta, para no revelar qué
   * correos están registrados.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return;

    const token = await this.tokens.issue(
      user.id,
      UserTokenType.RESET_PASSWORD,
    );
    await this.mail.send({
      ...resetPasswordTemplate(
        user.name,
        `${this.appUrl}/reset-password?token=${token}`,
      ),
      to: user.email,
      type: 'account.reset-password',
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.tokens.consume(
      token,
      UserTokenType.RESET_PASSWORD,
    );
    await this.usersService.updatePassword(
      userId,
      await bcrypt.hash(password, SALT_ROUNDS),
    );
    // Recibió el enlace en su correo: eso también prueba que es suyo
    const user = await this.usersService.findById(userId);
    if (user && !user.emailVerifiedAt) {
      await this.usersService.markEmailVerified(userId);
    }
  }

  // ─── Cuenta ──────────────────────────────────────────────

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    await this.usersService.updatePassword(
      userId,
      await bcrypt.hash(newPassword, SALT_ROUNDS),
    );
  }

  updateProfile(userId: string, name: string): Promise<PublicUser> {
    return this.usersService.updateProfile(userId, { name });
  }

  /** Emite el JWT de sesión para un usuario (también lo usa el flujo de invitaciones). */
  async buildAuthResponse(user: PublicUser): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, user };
  }
}
