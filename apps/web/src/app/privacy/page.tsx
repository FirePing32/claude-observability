import type { Metadata } from "next";
import { LegalPage, REPO_URL } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy policy · Claude Observability" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="October 8, 2026">
      <p>
        Claude Observability (&ldquo;the service&rdquo;) shows how a Claude subscription is used. This policy explains what the service collects, why, and
        what you can do about it. The service is open source; you can read exactly what it does at <a href={REPO_URL}>{REPO_URL}</a>.
      </p>

      <h2>Information from Google sign-in</h2>
      <p>
        When you sign in with Google we receive your name, e-mail address and profile picture (the <code>openid</code>, <code>email</code> and{" "}
        <code>profile</code> scopes). We use them only to identify you and check that your e-mail is approved to use the service.
        We do not request access to Gmail, Drive, Calendar or any other Google data.
      </p>

      <h2>Usage data uploaded by the collector</h2>
      <p>The <code>claude-obs</code> collector, which you install and run on your own computers, uploads usage records from Claude Code:</p>
      <ul>
        <li>request, message and session identifiers, and timestamps</li>
        <li>model names and token counts (input, output, thinking, cache reads and writes)</li>
        <li>labels such as effort level, speed, entry point, Claude Code version, and the names of subagents, skills and plugins</li>
        <li>the name of the project folder (or a salted hash, if you turn that on) and the git branch</li>
        <li>session titles, unless you turn them off with <code>claude-obs config titles off</code></li>
        <li>error categories and usage-limit events</li>
        <li>a salted hash of your Claude account id, used only to keep data from different accounts apart</li>
        <li>
          a one-way hash of your Claude account e-mail, compared against the workspace&apos;s approved e-mails to reject data from unapproved accounts,
          then discarded (never stored)
        </li>
      </ul>
      <p>
        <strong>The collector never uploads</strong> prompts, responses, model thinking, code, file contents, tool inputs or outputs, full file paths,
        e-mail addresses from your Claude account, or Claude credentials. If you enable Claude Code&apos;s OpenTelemetry export, the server ignores any
        content fields it contains.
      </p>

      <h2>How we use it</h2>
      <p>
        Only to provide the dashboard, insights and alerts you configure. We do not sell data, show ads, or use your data to train AI models. If a workspace
        owner enables the weekly AI digest, aggregated numbers (totals per model and project, without titles or content) are sent to Anthropic&apos;s API to
        write the summary.
      </p>

      <h2>Who can see it</h2>
      <p>
        Data belongs to a workspace. Workspace members see account-level totals and also usage per enrolled machine (each machine&apos;s name, its
        requests and API-equivalent value), which can indicate how much a particular computer, and so possibly a particular person, used. The service does
        not label usage by person. Only the workspace's owners, signed in with an approved account, can see it. There are no public or shared links. Service providers that process data on our behalf: Vercel (hosting), Neon (database), Google (sign-in), and, only if
        configured, Resend (alert e-mails) and Anthropic (AI digest).
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Usage records are kept for 13 months, upload logs for 90 days. A workspace owner can delete the workspace at any time in Settings, which permanently
        deletes all of its data. To delete your account, or for any privacy request, open an issue at <a href={`${REPO_URL}/issues`}>{REPO_URL}/issues</a>{" "}
        and we will follow up privately.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit. Machine tokens and enrollment codes are stored only as hashes and can be revoked at any time. Access is checked on every
        request.
      </p>

      <h2>Changes</h2>
      <p>We will update this page when the service changes what it collects, and change the date above.</p>

      <p className="text-sm text-muted">Claude Observability is not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic, PBC.</p>
    </LegalPage>
  );
}
