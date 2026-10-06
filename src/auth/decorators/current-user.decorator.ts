import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { PublicUser } from '../../users/entities/user.entity';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as PublicUser;
  },
);
