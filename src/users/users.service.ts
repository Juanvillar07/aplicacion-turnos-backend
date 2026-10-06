import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUser, toPublicUser } from './entities/user.entity';

export interface CreateUserData {
  email: string;
  name: string;
  password: string; // ya hasheada
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Uso interno (Auth): incluye el hash para poder comparar credenciales. */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<PublicUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? toPublicUser(user) : null;
  }

  async create(data: CreateUserData): Promise<PublicUser> {
    const user = await this.prisma.user.create({ data });
    return toPublicUser(user);
  }

  /** Uso interno (Auth): incluye el hash para verificar la contraseña actual. */
  findByIdWithPassword(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** `password` debe venir ya hasheada. */
  async updatePassword(id: string, password: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { password } });
  }

  async markEmailVerified(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
    });
    return toPublicUser(user);
  }

  async updateProfile(id: string, data: { name: string }): Promise<PublicUser> {
    const user = await this.prisma.user.update({ where: { id }, data });
    return toPublicUser(user);
  }
}
