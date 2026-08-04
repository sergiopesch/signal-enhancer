import { FatalError, getWritable } from "workflow";

import {
  GUIDED_READING_ID,
  GUIDED_READING_VERSION,
} from "@/lib/audio/reading-passage";
import {
  createPrivateReadUrl,
  createResultPutUrl,
  MAX_CAPTURE_BYTES,
  MAX_DIFFERENCE_BYTES,
  MAX_REPORT_BYTES,
  verifyResultArtifact,
} from "@/lib/server/blob";
import { workerResultSchema } from "@/lib/server/contracts";
import { requireLiveEnvironment } from "@/lib/server/env";
import {
  appendJobEvent,
  getExperimentSessionById,
  getJobById,
  getSessionCaptures,
  transitionJobStateIdempotently,
  updateJobStateIfCurrent,
} from "@/lib/server/repository";
import {
  assertProductionWorkerVersion,
  isRetryableWorkerStatus,
  probeProductionWorker,
  WorkerProbeError,
} from "@/lib/server/worker";

const STAGE_LABELS = {
  receiving_capture: "Receiving capture",
  inspecting_signal: "Inspecting signal",
  detecting_noise_and_compression: "Detecting noise and compression",
  restoring_detail: "Restoring detail",
  polishing_dynamics: "Polishing dynamics",
  generating_difference_map: "Generating difference map",
  preparing_report: "Preparing report",
} as const;

type WorkerStage = keyof typeof STAGE_LABELS;

type PreparedUpgrade = {
  jobId: string;
  attemptId: string;
  body: Record<string, unknown>;
  resultPaths: {
    enhanced: string;
    difference: string;
    report: string;
  };
};

export const UPGRADE_WORKER_MAX_RETRIES = 0;

export function upgradeResultCoordinates({
  sessionId,
  internalJobId,
  publicJobId,
}: {
  sessionId: string;
  internalJobId: string;
  publicJobId: string;
}) {
  const outputRoot = `sessions/${sessionId}/results/${internalJobId}/${publicJobId}`;
  return {
    attemptId: publicJobId,
    resultPaths: {
      enhanced: `${outputRoot}/enhanced.wav`,
      difference: `${outputRoot}/difference.json`,
      report: `${outputRoot}/report.json`,
    },
  };
}

type ProgressEvent = {
  sequence: number;
  stage: string;
  detail: string;
  status: "active" | "complete" | "failed";
  timestamp: string;
};

async function writeProgress(
  jobId: string,
  stage: string,
  detail: string,
  status: ProgressEvent["status"] = "active",
) {
  "use step";

  const sequence = await appendJobEvent(jobId, stage, status, detail);
  const event: ProgressEvent = {
    sequence,
    stage,
    detail,
    status,
    timestamp: new Date().toISOString(),
  };
  const writer = getWritable<Uint8Array>().getWriter();
  await writer.write(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
  writer.releaseLock();
  return event;
}

async function prepareUpgrade(jobId: string): Promise<PreparedUpgrade> {
  "use step";

  const job = await getJobById(jobId);
  const [captureRows, session] = await Promise.all([
    getSessionCaptures(job.sessionId),
    getExperimentSessionById(job.sessionId),
  ]);
  if (
    session.referenceId !== GUIDED_READING_ID ||
    session.referenceRevision !== GUIDED_READING_VERSION
  )
    throw new FatalError(
      "This upgrade worker does not support the session capture protocol.",
    );
  const inputA = captureRows.find((capture) => capture.slot === "A");
  const inputB = captureRows.find((capture) => capture.slot === "B");
  if (!inputA || !inputB)
    throw new FatalError(
      "Both committed captures are required before an upgrade can start.",
    );

  // This job has exactly one non-retried worker invocation, so its persisted
  // public UUID is also the stable worker-attempt coordinate. If this durable
  // preparation step is replayed, it remints short-lived grants for the same
  // immutable paths instead of orphaning a fresh path on every retry.
  const { attemptId, resultPaths } = upgradeResultCoordinates({
    sessionId: job.sessionId,
    internalJobId: job.id,
    publicJobId: job.publicId,
  });
  const inputAUrl = await createPrivateReadUrl(
    inputA.pathname,
    "get",
    job.expiresAt,
  );
  const inputBUrl = await createPrivateReadUrl(
    inputB.pathname,
    "get",
    job.expiresAt,
  );
  const activeJob = await updateJobStateIfCurrent(
    jobId,
    ["processing"],
    "processing",
    {
      resultPathname: resultPaths.enhanced,
      differencePathname: resultPaths.difference,
      reportPathname: resultPaths.report,
    },
  );
  if (!activeJob) throw new FatalError("This upgrade is no longer active.");
  const [enhancedUrl, differenceUrl, reportUrl] = await Promise.all([
    createResultPutUrl(
      resultPaths.enhanced,
      "audio/wav",
      job.expiresAt,
      MAX_CAPTURE_BYTES,
    ),
    createResultPutUrl(
      resultPaths.difference,
      "application/json",
      job.expiresAt,
      MAX_DIFFERENCE_BYTES,
    ),
    createResultPutUrl(
      resultPaths.report,
      "application/json",
      job.expiresAt,
      MAX_REPORT_BYTES,
    ),
  ]);

  const expiresAt = (validUntil: number) => new Date(validUntil).toISOString();
  const inputDescriptor = (
    capture: typeof inputA,
    signed: Awaited<ReturnType<typeof createPrivateReadUrl>>,
  ) => ({
    object_path: capture.pathname,
    url: signed.url,
    expires_at: expiresAt(signed.validUntil),
    byte_size: capture.bytes,
    sha256: capture.sha256,
    content_type: "audio/wav",
  });
  const outputDescriptor = (
    pathname: string,
    signed: Awaited<ReturnType<typeof createResultPutUrl>>,
    contentType: "audio/wav" | "application/json",
    maximumSizeInBytes: number,
  ) => ({
    object_path: pathname,
    url: signed.url,
    expires_at: expiresAt(signed.validUntil),
    max_bytes: maximumSizeInBytes,
    content_type: contentType,
  });

  return {
    jobId,
    attemptId,
    resultPaths,
    body: {
      schema_version: "1",
      job_id: job.id,
      attempt_id: attemptId,
      reference: {
        id: session.referenceId,
        revision: session.referenceRevision,
      },
      inputs: {
        a: inputDescriptor(inputA, inputAUrl),
        b: inputDescriptor(inputB, inputBUrl),
      },
      source: "A",
      outputs: {
        enhanced_wav: outputDescriptor(
          resultPaths.enhanced,
          enhancedUrl,
          "audio/wav",
          MAX_CAPTURE_BYTES,
        ),
        difference_json: outputDescriptor(
          resultPaths.difference,
          differenceUrl,
          "application/json",
          MAX_DIFFERENCE_BYTES,
        ),
        report_json: outputDescriptor(
          resultPaths.report,
          reportUrl,
          "application/json",
          MAX_REPORT_BYTES,
        ),
      },
    },
  };
}

async function beginUpgrade(jobId: string) {
  "use step";

  const job = await getJobById(jobId);
  const captureRows = await getSessionCaptures(job.sessionId);
  if (
    !captureRows.some((capture) => capture.slot === "A") ||
    !captureRows.some((capture) => capture.slot === "B")
  ) {
    throw new FatalError(
      "Both committed captures are required before an upgrade can start.",
    );
  }
  const activeJob = await transitionJobStateIdempotently(
    jobId,
    "queued",
    "warming",
    {
      startedAt: new Date(),
      attemptCount: job.attemptCount + 1,
    },
  );
  if (!activeJob) throw new FatalError("This upgrade is no longer active.");
  if (!activeJob.transitioned) return;
  await writeProgress(
    jobId,
    STAGE_LABELS.receiving_capture,
    "Both private WAV captures are committed and ready.",
  );
}

async function warmUpgradeEngine(jobId: string) {
  "use step";

  const job = await getJobById(jobId);
  if (job.state === "processing") return;
  if (job.state !== "warming")
    throw new FatalError("This upgrade is no longer active.");

  const environment = requireLiveEnvironment();
  const response = await fetch(`${environment.HF_ENDPOINT_URL}/health`, {
    headers: {
      Authorization: `Bearer ${environment.HF_ENDPOINT_TOKEN}`,
      "X-Signal-Endpoint-Secret": environment.HF_ENDPOINT_SHARED_SECRET,
      "X-Scale-Up-Timeout": "600",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(610_000),
  });
  if (isRetryableWorkerStatus(response.status)) {
    throw new Error(`Upgrade engine is still warming (${response.status}).`);
  }
  if (!response.ok)
    throw new FatalError(
      `Upgrade engine health check failed (${response.status}).`,
    );
  const health = await response.json().catch(() => null);
  if (
    !health ||
    typeof health !== "object" ||
    (health as Record<string, unknown>).status !== "ready"
  ) {
    throw new FatalError("Upgrade engine returned an invalid health record.");
  }
  try {
    await probeProductionWorker(environment);
  } catch (error) {
    if (error instanceof WorkerProbeError && error.retryable) throw error;
    throw new FatalError(
      "Upgrade engine does not match the approved production release.",
    );
  }
  const activeJob = await transitionJobStateIdempotently(
    jobId,
    "warming",
    "processing",
  );
  if (!activeJob) throw new FatalError("This upgrade is no longer active.");
}

function safeWorkerError(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  return {
    code: typeof object.code === "string" ? object.code : "worker_error",
    message:
      typeof object.message === "string"
        ? object.message
        : "The upgrade engine rejected this capture.",
    retryable: object.retryable === true,
  };
}

async function invokeUpgradeEngine(prepared: PreparedUpgrade) {
  "use step";

  const environment = requireLiveEnvironment();
  const response = await fetch(`${environment.HF_ENDPOINT_URL}/v1/enhance`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.HF_ENDPOINT_TOKEN}`,
      "X-Signal-Endpoint-Secret": environment.HF_ENDPOINT_SHARED_SECRET,
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
      "X-Scale-Up-Timeout": "600",
    },
    body: JSON.stringify(prepared.body),
    cache: "no-store",
    redirect: "error",
    // Result grants live for five minutes. Never let a single attempt outlive
    // the immutable input/output URLs that scope it.
    signal: AbortSignal.timeout(280_000),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const workerError = safeWorkerError(payload);
    if (isRetryableWorkerStatus(response.status) || workerError?.retryable) {
      throw new Error(
        workerError?.message ??
          `Upgrade worker temporarily unavailable (${response.status}).`,
      );
    }
    throw new FatalError(
      workerError?.message ??
        `Upgrade worker rejected the capture (${response.status}).`,
    );
  }
  if (!response.body)
    throw new Error("Upgrade worker returned no progress stream.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let resultPayload: unknown = null;
  const emitted = new Set<WorkerStage>(["receiving_capture"]);

  const consumeLine = async (line: string) => {
    if (!line.trim()) return;
    const envelope = JSON.parse(line) as Record<string, unknown>;
    if (
      envelope.type === "stage" &&
      typeof envelope.stage === "string" &&
      envelope.stage in STAGE_LABELS
    ) {
      const stage = envelope.stage as WorkerStage;
      if (!emitted.has(stage)) {
        emitted.add(stage);
        await writeProgress(
          prepared.jobId,
          STAGE_LABELS[stage],
          `The worker entered ${STAGE_LABELS[stage].toLowerCase()}.`,
        );
      }
    }
    if (envelope.type === "result") resultPayload = envelope.result;
    if (envelope.type === "error") {
      const workerError = safeWorkerError(envelope.error);
      if (workerError?.retryable) throw new Error(workerError.message);
      throw new FatalError(
        workerError?.message ?? "The upgrade engine rejected this capture.",
      );
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += chunk.value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) await consumeLine(line);
  }
  if (buffer.trim()) await consumeLine(buffer);
  if (!resultPayload)
    throw new Error("Upgrade worker completed without a result record.");
  const result = workerResultSchema.parse(resultPayload);
  try {
    assertProductionWorkerVersion(
      result.versions,
      environment.HF_ENDPOINT_BUILD_REVISION,
    );
  } catch {
    throw new FatalError(
      "Upgrade worker result came from an unapproved production release.",
    );
  }
  const artifactPaths = result.artifacts;
  if (
    result.job_id !== prepared.jobId ||
    result.attempt_id !== prepared.attemptId ||
    artifactPaths.enhanced_wav.object_path !== prepared.resultPaths.enhanced ||
    artifactPaths.difference_json.object_path !==
      prepared.resultPaths.difference ||
    artifactPaths.report_json.object_path !== prepared.resultPaths.report
  ) {
    throw new FatalError(
      "Upgrade worker returned an artifact receipt outside this attempt.",
    );
  }

  await Promise.all([
    verifyResultArtifact(
      artifactPaths.enhanced_wav.object_path,
      artifactPaths.enhanced_wav.byte_size,
      "audio/wav",
      MAX_CAPTURE_BYTES,
    ),
    verifyResultArtifact(
      artifactPaths.difference_json.object_path,
      artifactPaths.difference_json.byte_size,
      "application/json",
      MAX_DIFFERENCE_BYTES,
    ),
    verifyResultArtifact(
      artifactPaths.report_json.object_path,
      artifactPaths.report_json.byte_size,
      "application/json",
      MAX_REPORT_BYTES,
    ),
  ]);

  const completedJob = await updateJobStateIfCurrent(
    prepared.jobId,
    ["processing"],
    "completed",
    {
      completedAt: new Date(),
      resultPathname: result.artifacts.enhanced_wav.object_path,
      differencePathname: result.artifacts.difference_json.object_path,
      reportPathname: result.artifacts.report_json.object_path,
      resultSha256: result.artifacts.enhanced_wav.sha256,
      routing: result.routing,
      resultMetadata: {
        before: result.before,
        after: result.after,
        comparisonB: result.comparison_b,
        versions: result.versions,
      },
    },
  );
  if (!completedJob) throw new FatalError("This upgrade is no longer active.");
  await writeProgress(
    prepared.jobId,
    STAGE_LABELS.preparing_report,
    "The enhanced WAV and transparent processing record are ready.",
    "complete",
  );
  return result;
}

// Retrying this step would reuse non-overwriting result paths after a partial
// upload. Only preparation may retry and remint grants for this persisted
// attempt coordinate; the worker invocation itself is deliberately once-only.
invokeUpgradeEngine.maxRetries = UPGRADE_WORKER_MAX_RETRIES;

async function failUpgrade(jobId: string, message: string) {
  "use step";

  const failedJob = await updateJobStateIfCurrent(
    jobId,
    ["queued", "warming", "processing"],
    "failed",
    {
      completedAt: new Date(),
      errorCode: "upgrade_failed",
      errorMessage:
        "The deeper restoration did not finish. Your browser preview remains available.",
    },
  );
  if (!failedJob) {
    await getWritable<Uint8Array>().close();
    return;
  }
  await writeProgress(jobId, "Upgrade unavailable", message, "failed");
  await getWritable<Uint8Array>().close();
}

async function closeProgressStream() {
  "use step";
  await getWritable<Uint8Array>().close();
}

export async function upgradeSignalWorkflow(jobId: string) {
  "use workflow";

  try {
    await beginUpgrade(jobId);
    await warmUpgradeEngine(jobId);
    const prepared = await prepareUpgrade(jobId);
    const result = await invokeUpgradeEngine(prepared);
    await closeProgressStream();
    return { status: "completed", result };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The upgrade engine stopped unexpectedly.";
    await failUpgrade(jobId, message);
    return { status: "failed" };
  }
}
