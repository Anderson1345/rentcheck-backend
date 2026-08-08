import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

interface RequestConUsuario {
  user?: { inquilinoId?: string };
}

export const InquilinoActual = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestConUsuario>();
    const inquilinoId = request.user?.inquilinoId;

    if (!inquilinoId) {
      throw new UnauthorizedException(
        'El token no corresponde a un Inquilino.',
      );
    }

    return inquilinoId;
  },
);
