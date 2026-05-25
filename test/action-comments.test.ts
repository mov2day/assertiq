import { describe, expect, it, vi } from "vitest";
import { findStickyCommentId, safeUpsertStickyComment, upsertStickyComment, type StickyCommentApi } from "../src/action-comments.js";

const MARKER = "<!-- assertiq-comment -->";
const CONTEXT = { owner: "mov2day", repo: "assertiq", issue_number: 12 };

describe("action comments", () => {
  it("finds sticky comment across pages", async () => {
    const api: StickyCommentApi = {
      listComments: vi
        .fn()
        .mockResolvedValueOnce({
          data: Array.from({ length: 100 }).map((_, index) => ({ id: index + 1, body: "plain comment" }))
        })
        .mockResolvedValueOnce({
          data: [{ id: 777, body: `${MARKER}\nexisting` }]
        }),
      updateComment: vi.fn(),
      createComment: vi.fn()
    };
    const found = await findStickyCommentId(api, CONTEXT, MARKER);
    expect(found).toBe(777);
    expect(api.listComments).toHaveBeenCalledTimes(2);
  });

  it("updates existing sticky comment", async () => {
    const api: StickyCommentApi = {
      listComments: vi.fn().mockResolvedValue({ data: [{ id: 50, body: MARKER }] }),
      updateComment: vi.fn().mockResolvedValue({}),
      createComment: vi.fn().mockResolvedValue({})
    };
    const result = await upsertStickyComment(api, CONTEXT, MARKER, "new body");
    expect(result).toBe("updated");
    expect(api.updateComment).toHaveBeenCalledWith({
      owner: CONTEXT.owner,
      repo: CONTEXT.repo,
      comment_id: 50,
      body: "new body"
    });
    expect(api.createComment).not.toHaveBeenCalled();
  });

  it("creates sticky comment when missing", async () => {
    const api: StickyCommentApi = {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      updateComment: vi.fn().mockResolvedValue({}),
      createComment: vi.fn().mockResolvedValue({})
    };
    const result = await upsertStickyComment(api, CONTEXT, MARKER, "body");
    expect(result).toBe("created");
    expect(api.createComment).toHaveBeenCalledWith({
      owner: CONTEXT.owner,
      repo: CONTEXT.repo,
      issue_number: CONTEXT.issue_number,
      body: "body"
    });
  });

  it("handles permission failures with warning callback", async () => {
    const api: StickyCommentApi = {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      updateComment: vi.fn().mockResolvedValue({}),
      createComment: vi.fn().mockRejectedValue(new Error("Resource not accessible by integration"))
    };
    const warning = vi.fn();
    const ok = await safeUpsertStickyComment(api, CONTEXT, MARKER, "body", warning);
    expect(ok).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      "Could not post AssertIQ PR comment: Resource not accessible by integration. " +
        "Check workflow token permissions (`issues: write`). For forked `pull_request` runs, " +
        "`GITHUB_TOKEN` is read-only; disable comments for forks or use a hardened `pull_request_target` " +
        "comment-only workflow."
    );
  });

  it("passes through non-permission failures in warning callback", async () => {
    const api: StickyCommentApi = {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      updateComment: vi.fn().mockResolvedValue({}),
      createComment: vi.fn().mockRejectedValue(new Error("socket hang up"))
    };
    const warning = vi.fn();
    const ok = await safeUpsertStickyComment(api, CONTEXT, MARKER, "body", warning);
    expect(ok).toBe(false);
    expect(warning).toHaveBeenCalledWith("Could not post AssertIQ PR comment: socket hang up");
  });
});
