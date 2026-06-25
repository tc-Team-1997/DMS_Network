import jwt from "jsonwebtoken";

export interface TokenPayload {
  sub: string;
  username: string;
  // Optional RBAC claims embedded by the gateway at login so that downstream
  // microservices can authorize from the token without a shared user DB.
  roles?: string[];
  permissions?: string[];
  branch?: string;
  region?: string;
}

export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "1h", algorithm: "HS256" });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const raw = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (typeof raw === "string") {
    throw new Error("invalid token payload: string payload");
  }
  const decoded = raw as jwt.JwtPayload;
  if (decoded.sub == null || decoded.username == null) {
    throw new Error("invalid token payload: missing fields");
  }
  return { sub: String(decoded.sub), username: String(decoded.username) };
}
