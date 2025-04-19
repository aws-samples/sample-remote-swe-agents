import { randomBytes } from "crypto";

export const WorkerId = process.env.WORKER_ID ?? randomBytes(10).toString('hex');
