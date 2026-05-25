export interface StickyCommentContext {
  owner: string;
  repo: string;
  issue_number: number;
}

export interface StickyCommentApi {
  listComments(params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page: number;
    page: number;
  }): Promise<{ data: Array<{ id: number; body?: string | null }> }>;
  updateComment(params: {
    owner: string;
    repo: string;
    comment_id: number;
    body: string;
  }): Promise<unknown>;
  createComment(params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }): Promise<unknown>;
}

export async function findStickyCommentId(
  api: StickyCommentApi,
  context: StickyCommentContext,
  marker: string,
  perPage = 100
): Promise<number | undefined> {
  let page = 1;
  while (true) {
    const response = await api.listComments({
      ...context,
      per_page: perPage,
      page
    });
    const found = response.data.find((comment) => comment.body?.includes(marker));
    if (found) return found.id;
    if (response.data.length < perPage) return undefined;
    page += 1;
  }
}

export async function upsertStickyComment(
  api: StickyCommentApi,
  context: StickyCommentContext,
  marker: string,
  body: string
): Promise<"updated" | "created"> {
  const existingId = await findStickyCommentId(api, context, marker);
  if (existingId) {
    await api.updateComment({
      owner: context.owner,
      repo: context.repo,
      comment_id: existingId,
      body
    });
    return "updated";
  }
  await api.createComment({
    ...context,
    body
  });
  return "created";
}

export async function safeUpsertStickyComment(
  api: StickyCommentApi,
  context: StickyCommentContext,
  marker: string,
  body: string,
  onWarning: (message: string) => void
): Promise<boolean> {
  try {
    await upsertStickyComment(api, context, marker, body);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Resource not accessible by integration")) {
      onWarning(
        "Could not post AssertIQ PR comment: Resource not accessible by integration. " +
          "Check workflow token permissions (`issues: write`). For forked `pull_request` runs, " +
          "`GITHUB_TOKEN` is read-only; disable comments for forks or use a hardened `pull_request_target` " +
          "comment-only workflow."
      );
      return false;
    }
    onWarning(`Could not post AssertIQ PR comment: ${message}`);
    return false;
  }
}
