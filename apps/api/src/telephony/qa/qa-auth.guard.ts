import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class QaAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;
    const qaKeyHeader = req.headers['x-qa-key'] || req.headers['x-qa-secret'];

    // 1. Check QA secret headers
    const configuredSecret =
      process.env.TELEPHONY_QA_SECRET ||
      process.env.QA_API_KEY ||
      process.env.QA_SECRET_KEY ||
      'callflow-qa-secret';

    if (qaKeyHeader && qaKeyHeader === configuredSecret) {
      req.user = { userId: 'qa-runner', role: 'QA_AUTOMATION' };
      return true;
    }

    if (!authHeader) {
      throw new UnauthorizedException('Authentication required for QA operations');
    }

    // 2. Check Bearer QA secret
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();

      if (token === configuredSecret) {
        req.user = { userId: 'qa-runner', role: 'QA_AUTOMATION' };
        return true;
      }

      // 3. Check JWT token
      const jwtSecret = process.env.JWT_SECRET;
      if (jwtSecret) {
        try {
          const decoded: any = jwt.verify(token, jwtSecret);
          req.user = {
            userId: decoded.sub || decoded.userId || decoded.id,
            role: decoded.role || 'USER',
            ...decoded,
          };
          return true;
        } catch {
          // Token is not a valid JWT
        }
      }
    }

    throw new UnauthorizedException('Invalid authentication credentials for QA operations');
  }
}
