import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { captureRawBody } from "./rawBody.js";

const app = express();
app.use(express.json({ verify: captureRawBody }));
app.post("/echo", (req, res) => {
  res.json({
    rawIsBuffer: Buffer.isBuffer((req as any).rawBody),
    raw: (req as any).rawBody?.toString("utf8"),
    parsed: req.body,
  });
});

describe("captureRawBody", () => {
  it("stores the exact raw bytes alongside the parsed body", async () => {
    const payload = '{"b":2,"a":1}'; // deliberately non-alphabetical to prove no re-serialization
    const res = await request(app).post("/echo").set("Content-Type", "application/json").send(payload);
    expect(res.status).toBe(200);
    expect(res.body.rawIsBuffer).toBe(true);
    expect(res.body.raw).toBe(payload);
    expect(res.body.parsed).toEqual({ b: 2, a: 1 });
  });
});
