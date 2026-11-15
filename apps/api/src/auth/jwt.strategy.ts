import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { passportJwtSecret } from 'jwks-rsa';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly configuredSupabaseUrl: string | undefined;
  private readonly trustedIssuers = new Set<string>();

  constructor() {
    let supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

    // Defense-in-depth: if not yet present in process.env, attempt deterministic load of apps/api/.env
    if (!supabaseUrl) {
      try {
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const candidatePaths = [
          path.resolve(currentDir, '../../.env'), // src/auth or dist/auth -> apps/api/.env
          path.resolve(currentDir, '../../../apps/api/.env'),
          path.resolve(process.cwd(), '.env'),
          path.resolve(process.cwd(), 'apps/api/.env'),
        ];
        for (const candidate of candidatePaths) {
          if (fs.existsSync(candidate)) {
            dotenv.config({ path: candidate });
            supabaseUrl =
              process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
            if (supabaseUrl) break;
          }
        }
      } catch {
        // Fallback gracefully to environment validation below
      }
    }

    const jwksProvider = supabaseUrl
      ? passportJwtSecret({
          cache: true,
          rateLimit: true,
          jwksRequestsPerMinute: 5,
          jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
        })
      : null;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: 'authenticated',
      algorithms: ['HS256', 'ES256', 'RS256'],
      secretOrKeyProvider: (req: any, rawJwtToken: string, done: any) => {
        try {
          if (!rawJwtToken) {
            return done(new UnauthorizedException('Token missing'), null);
          }
          const [headerB64] = rawJwtToken.split('.');
          if (!headerB64) {
            return done(new UnauthorizedException('Invalid JWT format'), null);
          }
          const header = JSON.parse(
            Buffer.from(headerB64, 'base64url').toString('utf8'),
          );

          if (header.alg === 'HS256') {
            const secret = process.env.JWT_SECRET;
            if (!secret) {
              return done(
                new UnauthorizedException('JWT_SECRET is not configured'),
                null,
              );
            }
            return done(null, secret);
          }

          if (header.alg === 'ES256' || header.alg === 'RS256') {
            if (jwksProvider) {
              return jwksProvider(req, rawJwtToken, done);
            }
            return done(
              new UnauthorizedException('SUPABASE_URL is not configured for JWKS'),
              null,
            );
          }

          return done(
            new UnauthorizedException(`Unsupported JWT algorithm: ${header.alg}`),
            null,
          );
        } catch (err) {
          return done(err, null);
        }
      },
    });

    this.configuredSupabaseUrl = supabaseUrl;

    // Initialize trusted issuers immutably at constructor time after super()
    if (supabaseUrl) {
      this.trustedIssuers.add(`${supabaseUrl}/auth/v1`);
      try {
        const parsed = new URL(supabaseUrl);
        this.trustedIssuers.add(`${parsed.origin}/auth/v1`);
      } catch {
        // ignore
      }
    }
    this.trustedIssuers.add('supabase');
    if (process.env.JWT_ISSUER) {
      this.trustedIssuers.add(process.env.JWT_ISSUER);
    }
  }

  async validate(payload: any) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Token subject (user ID) is missing');
    }

    const currentUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      this.configuredSupabaseUrl;

    // Explicitly configured trusted issuers - mandatory check
    const trusted = new Set<string>(this.trustedIssuers);
    if (currentUrl) {
      trusted.add(`${currentUrl}/auth/v1`);
      try {
        const parsed = new URL(currentUrl);
        trusted.add(`${parsed.origin}/auth/v1`);
      } catch {
        // ignore
      }
    }
    trusted.add('supabase');
    if (process.env.JWT_ISSUER) {
      trusted.add(process.env.JWT_ISSUER);
    }

    if (!payload.iss || !trusted.has(payload.iss)) {
      this.logger.error(
        `Token rejected: payload.iss ('${payload.iss}') is not in trusted issuers: [${Array.from(trusted).join(', ')}]`,
      );
      throw new UnauthorizedException('Invalid or missing token issuer');
    }

    return { 
      userId: payload.sub, 
      email: payload.email, 
      role: payload.role,
      fullName: payload.user_metadata?.full_name
    };
  }
}
