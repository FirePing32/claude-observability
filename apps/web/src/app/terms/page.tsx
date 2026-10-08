import type { Metadata } from "next";
import { LegalPage, REPO_URL } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of service · Claude Observability" };

export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="October 8, 2026">
      <p>By signing in to or using Claude Observability (&ldquo;the service&rdquo;) you agree to these terms.</p>

      <h2>The service</h2>
      <p>
        The service displays usage analytics for Claude Code based on data that you choose to upload from your own computers. Dollar amounts are estimates of
        what the same usage would cost at Anthropic&apos;s published API prices; they are not bills, and limit estimates are models, not guarantees.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only upload data from Claude accounts and computers you are allowed to use, and only invite people who should see that data.</li>
        <li>Keep machine tokens and enrollment codes private, and revoke them if they are exposed.</li>
        <li>Use Claude itself in line with Anthropic&apos;s terms; this service does not change those terms.</li>
        <li>Don&apos;t misuse the service: no attempts to access other workspaces, overload the API, or upload content that isn&apos;t usage data.</li>
      </ul>

      <h2>Availability</h2>
      <p>The service is provided free of charge, as is, and may change or stop at any time. We may suspend access that abuses the service.</p>

      <h2>No warranty and limitation of liability</h2>
      <p>
        The service and its software are provided &ldquo;as is&rdquo;, without warranty of any kind. To the extent permitted by law, we are not liable for any
        damages arising from using the service, including decisions made based on its numbers. The source code is available under the MIT License at{" "}
        <a href={REPO_URL}>{REPO_URL}</a>.
      </p>

      <h2>Privacy</h2>
      <p>
        How data is handled is described in the <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`${REPO_URL}/issues`}>{REPO_URL}/issues</a>.
      </p>

      <p className="text-sm text-muted">Claude Observability is not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic, PBC.</p>
    </LegalPage>
  );
}
