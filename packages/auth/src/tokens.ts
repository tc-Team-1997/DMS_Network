import jwt from "jsonwebtoken";

export interface TokenPayload { sub: number; username: string; }

export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "1h" });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  return { sub: Number(decoded.sub), username: String(decoded.username) };
}
