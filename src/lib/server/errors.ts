import "server-only";

export class SignalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SignalError";
  }
}

export function safeErrorResponse(error: unknown) {
  if (error instanceof SignalError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_request_error",
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "The signal path is temporarily unavailable.",
      },
    },
    { status: 500 },
  );
}

export function assertSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new SignalError(
      "cross_origin_request",
      "This request must originate from Signal Enhancer.",
      403,
    );
  }
}
