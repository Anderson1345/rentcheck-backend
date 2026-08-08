import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

interface RequestConUsuario {
  user?: { inquilinoId?: string };
}

@Injectable()
export class InquilinoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestConUsuario>();
    if (!request.user?.inquilinoId) {
      throw new UnauthorizedException(
        'El token no corresponde a un Inquilino.',
      );
    }
    return true;
  }
}
