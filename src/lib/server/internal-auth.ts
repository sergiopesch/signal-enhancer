import "server-only";

import { timingSafeEqual } from "node:crypto";

import { SignalError } from "./errors";

export function requireInternalBearerAuthorization(
  request: Request,
  secret: string,
) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const authorized =
    supplied.length === expected.length && timingSafeEqual(supplied, expected);

  if (!authorized) {
    throw new SignalError(
      "internal_unauthorized",
      "This internal request is not authorized.",
      401,
    );
  }
}
