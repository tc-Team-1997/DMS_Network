import jwt from "jsonwebtoken";

export interface TokenPayload { sub: number; username: string; }

export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "1h" });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const raw = jwt.verify(token, secret);
  if (typeof raw === "string") {
    throw new Error("invalid token payload: string payload");
  }
  const decoded = raw as jwt.JwtPayload;
  if (decoded.sub == null || decoded.username == null) {
    throw new Error("invalid token payload: missing fields");
  }
  return { sub: Number(decoded.sub), username: String(decoded.username) };
}
