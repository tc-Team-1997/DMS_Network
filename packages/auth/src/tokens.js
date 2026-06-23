import jwt from "jsonwebtoken";
export function signToken(payload, secret) {
    return jwt.sign(payload, secret, { expiresIn: "1h" });
}
export function verifyToken(token, secret) {
    const raw = jwt.verify(token, secret);
    if (typeof raw === "string") {
        throw new Error("invalid token payload: string payload");
    }
    const decoded = raw;
    if (decoded.sub == null || decoded.username == null) {
        throw new Error("invalid token payload: missing fields");
    }
    return { sub: Number(decoded.sub), username: String(decoded.username) };
}
