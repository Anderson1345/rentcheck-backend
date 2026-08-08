import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

interface RequestConUsuario {
  user?: { arrendadorId?: string };
}

@Injectable()
export class ArrendadorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestConUsuario>();
    if (!request.user?.arrendadorId) {
      throw new UnauthorizedException(
        'El token no corresponde a un Arrendador.',
      );
    }
    return true;
  }
}
