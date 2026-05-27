export type PostContextJobStatus = "pending" | "ready" | "failed";

export interface VideoPostInput {
  postId: string;
  mediaType: string | null;
  permalink: string | null;
  caption: string | null;
}

export interface PostContextJob {
  id: string;
  postId: string;
  status: PostContextJobStatus;
  apifyRunId: string | null;
  apifyDatasetId: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostContext {
  id: string;
  postId: string;
  transcript: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApifyPostContextResult {
  runId: string | null;
  datasetId: string | null;
  transcript: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ApifyPostContextClient {
  fetchPostContext(input: { postUrl: string }): Promise<ApifyPostContextResult>;
}

export interface PostContextStore {
  getJobForPost(postId: string): Promise<PostContextJob | undefined>;
  createPendingJob(input: { postId: string; now: Date }): Promise<PostContextJob>;
  markJobReady(input: {
    postId: string;
    apifyRunId: string | null;
    apifyDatasetId: string | null;
    now: Date;
  }): Promise<PostContextJob>;
  markJobFailed(input: {
    postId: string;
    failureReason: string;
    apifyRunId?: string | null;
    apifyDatasetId?: string | null;
    now: Date;
  }): Promise<PostContextJob>;
  upsertContext(input: {
    postId: string;
    transcript: string | null;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
    sourceUrl: string | null;
    metadata: Record<string, unknown> | null;
    now: Date;
  }): Promise<PostContext>;
  getContextForPost(postId: string): Promise<PostContext | undefined>;
}

export interface RunPostContextJobOptions {
  store: PostContextStore;
  client: ApifyPostContextClient;
  now?: Date;
}

export interface RunPostContextJobResult {
  status: PostContextJobStatus | "skipped";
  job?: PostContextJob;
  context?: PostContext;
  reason?: string;
}

export async function runPostContextJobForPost(
  post: VideoPostInput,
  opts: RunPostContextJobOptions
): Promise<RunPostContextJobResult> {
  const now = opts.now ?? new Date();

  if (post.mediaType !== "VIDEO") {
    return { status: "skipped", reason: "not_video" };
  }

  if (!post.permalink) {
    const job = await opts.store.createPendingJob({ postId: post.postId, now });
    const failed = await opts.store.markJobFailed({
      postId: post.postId,
      failureReason: "missing_permalink",
      now,
    });
    return { status: "failed", job: failed };
  }

  const existingReady = await opts.store.getContextForPost(post.postId);
  if (existingReady) {
    return {
      status: "ready",
      job: await opts.store.getJobForPost(post.postId),
      context: existingReady,
    };
  }

  await opts.store.createPendingJob({ postId: post.postId, now });

  try {
    const result = await opts.client.fetchPostContext({ postUrl: post.permalink });
    const context = await opts.store.upsertContext({
      postId: post.postId,
      transcript: result.transcript,
      durationSeconds: result.durationSeconds,
      thumbnailUrl: result.thumbnailUrl,
      sourceUrl: result.sourceUrl,
      metadata: result.metadata ?? null,
      now,
    });
    const job = await opts.store.markJobReady({
      postId: post.postId,
      apifyRunId: result.runId,
      apifyDatasetId: result.datasetId,
      now,
    });
    return { status: "ready", job, context };
  } catch (err) {
    const job = await opts.store.markJobFailed({
      postId: post.postId,
      failureReason: err instanceof Error ? err.message : String(err),
      now,
    });
    return { status: "failed", job };
  }
}

export function createMemoryPostContextStore(): PostContextStore {
  let nextId = 1;
  const jobs = new Map<string, PostContextJob>();
  const contexts = new Map<string, PostContext>();

  function id(prefix: string): string {
    return `${prefix}-${nextId++}`;
  }

  return {
    async getJobForPost(postId) {
      return jobs.get(postId);
    },
    async createPendingJob(input) {
      const existing = jobs.get(input.postId);
      if (existing) return existing;

      const job: PostContextJob = {
        id: id("job"),
        postId: input.postId,
        status: "pending",
        apifyRunId: null,
        apifyDatasetId: null,
        failureReason: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      jobs.set(input.postId, job);
      return job;
    },
    async markJobReady(input) {
      const job =
        jobs.get(input.postId) ??
        (await this.createPendingJob({ postId: input.postId, now: input.now }));
      job.status = "ready";
      job.apifyRunId = input.apifyRunId;
      job.apifyDatasetId = input.apifyDatasetId;
      job.failureReason = null;
      job.updatedAt = input.now;
      return job;
    },
    async markJobFailed(input) {
      const job =
        jobs.get(input.postId) ??
        (await this.createPendingJob({ postId: input.postId, now: input.now }));
      job.status = "failed";
      job.apifyRunId = input.apifyRunId ?? null;
      job.apifyDatasetId = input.apifyDatasetId ?? null;
      job.failureReason = input.failureReason;
      job.updatedAt = input.now;
      return job;
    },
    async upsertContext(input) {
      const existing = contexts.get(input.postId);
      if (existing) {
        existing.transcript = input.transcript;
        existing.durationSeconds = input.durationSeconds;
        existing.thumbnailUrl = input.thumbnailUrl;
        existing.sourceUrl = input.sourceUrl;
        existing.metadata = input.metadata;
        existing.updatedAt = input.now;
        return existing;
      }

      const context: PostContext = {
        id: id("context"),
        postId: input.postId,
        transcript: input.transcript,
        durationSeconds: input.durationSeconds,
        thumbnailUrl: input.thumbnailUrl,
        sourceUrl: input.sourceUrl,
        metadata: input.metadata,
        createdAt: input.now,
        updatedAt: input.now,
      };
      contexts.set(input.postId, context);
      return context;
    },
    async getContextForPost(postId) {
      return contexts.get(postId);
    },
  };
}
