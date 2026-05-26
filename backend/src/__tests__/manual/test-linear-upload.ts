/**
 * Manual test for the Linear file upload path.
 *
 * Run from the project root with:
 *   set -a; source ../windmill/.env.local; set +a
 *   WEBMUX_DEBUG=1 bun run backend/src/__tests__/manual/test-linear-upload.ts WIN-1950
 *
 * Exits 0 on a successful upload + attachment, non-zero otherwise.
 */
import {
  attachToIssue,
  fetchIssueWithAttachments,
  uploadAttachmentFile,
} from "../../services/linear-service";

async function main(): Promise<number> {
  const issueId = process.argv[2];
  if (!issueId) {
    console.error("usage: test-linear-upload.ts <issue-id>");
    return 1;
  }
  if (!Bun.env.LINEAR_API_KEY?.trim()) {
    console.error("LINEAR_API_KEY env var is not set");
    return 1;
  }

  const issue = await fetchIssueWithAttachments(issueId);
  if (!issue.ok) {
    console.error(`fetchIssue failed: ${issue.error}`);
    return 1;
  }
  console.log(`resolved issue: ${issue.data.identifier} (${issue.data.id})`);

  const payload = {
    webmux: 1,
    note: "manual upload test from test-linear-upload.ts",
    timestamp: new Date().toISOString(),
    branch: "manual-test",
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  console.log(`uploading ${bytes.byteLength} bytes`);

  const upload = await uploadAttachmentFile({
    filename: `webmux-manual-test-${Date.now()}.json`,
    contentType: "application/json",
    body: bytes.buffer as ArrayBuffer,
  });
  if (!upload.ok) {
    console.error(`upload failed: ${upload.error}`);
    return 1;
  }
  console.log(`upload ok — assetUrl: ${upload.data.assetUrl}`);

  const attached = await attachToIssue({
    issueId: issue.data.id,
    title: "manual test",
    url: upload.data.assetUrl,
  });
  if (!attached.ok) {
    console.error(`attach failed: ${attached.error}`);
    return 1;
  }
  console.log(`attach ok — ${attached.data.url}`);
  return 0;
}

process.exit(await main());
