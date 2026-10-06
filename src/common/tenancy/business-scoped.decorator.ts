import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BusinessMemberGuard } from './business-member.guard';

/** Marca un controlador como privado de un negocio: JWT + membresía en `:businessId`. */
export const BusinessScoped = () =>
  applyDecorators(UseGuards(JwtAuthGuard, BusinessMemberGuard));
