// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import JwksRsa from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: JwksRsa.passportJwtSecret({
        jwksUri: 'https://api.clerk.com/.well-known/jwks.json',
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }),
      algorithms: ['RS256'],
      audience: process.env.CLERK_FRONTEND_API,
      issuer: 'https://api.clerk.com',
    });
  }
  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email };
  }
}
