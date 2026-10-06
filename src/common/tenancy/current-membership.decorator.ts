import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Membership } from '@prisma/client';
import { TenantRequest } from './business-member.guard';

export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Membership =>
    ctx.switchToHttp().getRequest<TenantRequest>().membership,
);
